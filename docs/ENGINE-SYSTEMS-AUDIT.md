# V2-Forward Engine Audit

This document is the Phase A audit artifact for the `v2` migration.

It is intentionally `v2`-forward:

- `v2` is the active engine under audit
- `v1` is frozen and is only inspected as source material for migration decisions
- no Phase B implementation work should start from this document until the review gate in the Port Queue section is closed by a documentation-only commit

Evidence precedence for this audit is:

1. code trace in the active repo
2. targeted Vitest execution
3. targeted runtime probes run on `2026-03-28`
4. existing docs only when they agree with code and tests

Named runtime probes used below:

- `runtime probe: split-pdf-copy-count-20260328`
- `runtime probe: style-source-drift-20260328`
- `runtime probe: duplicate-family-authors-20260328`
- `runtime probe: enrich-source-used-20260328`

## Coverage Table

### Stage And Subsystem Coverage

| Stage / Subsystem | v2 Contract / Module | Covered Behavior | Partial Coverage | Known Gap | Backed By |
|---|---|---|---|---|---|
| `ingest` | `server/engine/v2/stages/ingest.ts`, `InputProfile` | Source typing, structured schema detection, count estimation, routing signals, PDF and URL ingest, guardrails | Profile signals are descriptive more than prescriptive; downstream routing policy still leaks into later stages | No single policy table decides how ingest signals should alter detect/extract behavior | `server/engine/v2/pipeline.ts`, `server/engine/v2/stages/ingest.ts`, `server/engine/v2/pipeline.test.ts` |
| `split` | `server/engine/v2/stages/split.ts`, `V2SplitArtifact` | Structural splitting, opener scoring, oversized chunk recovery, URI-tail handling, LLM fallback, per-line debug | Split logic still depends on dense regex and hand-tuned opener weights in `rawPdfCopy.ts` | The PDF-copy regression fixture now collapses to 5 citations instead of the expected 8 | `server/engine/v2/split-contamination.test.ts`, `runtime probe: split-pdf-copy-count-20260328` |
| `rawPdfCopy` repair layer | `server/engine/v2/rawPdfCopy.ts`, `V2PreparedWorkingChunk` | Bounded repair surfaces, contamination flags, residual artifact tracking, allowlist-based PDF-copy cleanup | Repair policy is strong but still coupled directly to split scoring and regex-heavy chunk logic | Weak opener and wrapped-line behavior remain fragile enough to require dedicated stress reruns for each change | `server/engine/v2/rawPdfCopy.test.ts`, `server/engine/v2/split-contamination.test.ts`, `server/engine/v2/real-world-batches.test.ts` |
| `detect` | `server/engine/v2/stages/detect.ts` | Auto-style detection with ingest uncertainty penalties, user-style bypass, per-citation diagnostics | Detect still produces one label plus confidence, not a ranked family list | MLA website fixture drifts to Chicago in the active path | `server/engine/v2/style-source-regression.test.ts`, `runtime probe: style-source-drift-20260328` |
| `extract` | `server/engine/v2/stages/extract.ts`, `server/engine/v2/adapters.ts`, `CanonicalCitation` field values | Multi-candidate deterministic extraction, legacy parser reuse, working-chunk prep, type hints, GROBID/LLM fallback paths, author parsing, field confidence | Extraction still shares important ownership with legacy parser logic, especially parser heuristics and dynamic patterns | Source-type drift and author-shape corruption are still the main practical blockers in `v2` | `server/engine/v2/regression-pack.test.ts`, `server/engine/v2/style-source-regression.test.ts`, `server/engine/v2/fixtures/operationalAccuracyCorpus.ts` |
| `enrich` | `server/engine/v2/stages/enrich.ts`, `ResolutionMetadata`, `EnrichmentMetadata` | Strict network resolution, provider fan-out, authority-safe merge, provider-no-coverage handling, cache support, retraction propagation | The architecture is stable, but the product/test vocabulary around skipped vs unresolved verification is not fully aligned | One pipeline assertion expects `skipped` where the actual active path yields `unverifiable` / `provider_no_coverage` | `server/engine/v2/pipeline.test.ts`, `runtime probe: enrich-source-used-20260328`, `docs/strict-resolution-progress-20260322.md` |
| `normalize` | `server/engine/v2/stages/normalize.ts`, `NormalizationMetadata` | Unicode repair, DOI normalization, locator cleanup, group-author normalization, institution/publisher promotion, residual-artifact carry-through | Some semantic promotion still lives in normalize rather than an explicitly separate policy module | No dedicated normalization-only baseline exists to show behavior drift without full pipeline reruns | `server/engine/v2/stages/normalize.ts`, `server/engine/v2/validation-false-positives.test.ts` |
| `validate` | `server/engine/v2/stages/validate.ts`, `ValidationIssue` | Structural plausibility checks, contamination confirmation, protected-token corruption checks, locator and DOI validation, missing required field checks | Validation is rich but diagnostic-only; policy meaning is split between validate and score | There is no single table that maps each validation code to downstream scoring and rerun obligations | `server/engine/v2/stages/validate.ts`, `server/engine/v2/validation-false-positives.test.ts` |
| `truth` | `server/engine/v2/stages/truth.ts`, `TruthProvenance` | Approved-truth lookup, validated-output reuse, field-approval application, provenance carry-through | Truth ownership is clean, but it only helps where approved truth exists | No migration blocker; keep as a stable `v2` subsystem | `server/engine/v2/truth-stage.test.ts`, `server/engine/shared/truthResolver.ts` |
| `dedup` | `server/engine/v2/stages/dedup.ts`, `V2DuplicateEntry` | Structural duplicate detection, family hydration, changed-field penalties, revalidation after merge | Dedup still depends on upstream author parsing quality and family-strength ranking | Duplicate-family merge output is currently preserving malformed author fragments like `Reuben` and `David` in merged families | `server/engine/v2/regression-pack.test.ts`, `runtime probe: duplicate-family-authors-20260328` |
| `score` | `server/engine/v2/stages/score.ts`, `CitationQualityScore` | Field-level quality scores, bucket assignment, local-ready policy, unresolved-authority handling, residual-artifact downgrade rules | Powerful thresholds and caps are still encoded in code rather than a central policy table | Threshold tuning remains high risk because no single artifact defines intended bucket policy by issue code | `server/engine/v2/stages/score.ts`, `server/engine/v2/validation-false-positives.test.ts`, `scripts/v2PhaseBaseline.ts` |
| `render` | `server/engine/v2/stages/render.ts`, `RenderedCitation` | CSL rendering, post-CSL cleanup, fallback rendering, assertion summaries in output | `v2` render still imports legacy `fixFormatting` and `runAssertions` directly | There is no native `v2` render-policy module yet; render quality still depends on legacy ownership | `server/engine/v2/stages/render.ts`, `server/engine/strictRenderer.ts`, `server/engine/strictRenderer.test.ts` |
| `respond` / exports | `server/engine/v2/stages/respond.ts`, `server/routes/v2.ts`, `server/engine/v2/exportUrls.ts` | Response envelope, exports, timings, partial-result markers, async job integration | Export and response code are stable but inherit upstream quality | No blocking migration gap; keep stable while parser/render ownership moves underneath it | `server/routes/v2.ts`, `server/routes/v2.test.ts`, `server/engine/v2/pipeline.ts` |
| Legacy parser dependency in active `v2` | `server/engine/citationParser.ts` reached through `server/engine/v2/adapters.ts` | `v2` currently reuses legacy pre-normalization, style parsing, dynamic patterns, year recovery, and type scoring | The ownership boundary is still blurred: `v2` is active, but some of its critical extraction behavior is still provided by legacy parser internals | `v2` cannot fully delete legacy parser ownership until author parsing, type assignment, year recovery, and patterns are either ported or explicitly rejected | `server/engine/v2/adapters.ts`, `server/engine/citationParser.ts`, `server/engine/v2/regression-pack.test.ts` |
| Legacy renderer dependency in active `v2` | `server/engine/strictRenderer.ts` reached through `server/engine/v2/stages/render.ts` | `v2` currently inherits strict assertions and format repair by importing legacy renderer functions | Coverage exists today, but it is not natively owned by `v2` | Deleting legacy renderer before rehoming these assertions would silently lower render quality | `server/engine/v2/stages/render.ts`, `server/engine/strictRenderer.ts`, `server/engine/strictRenderer.test.ts` |
| Dynamic pattern store | `server/data/patterns.json`, `CitationParser.loadDynamicPatterns()` | Runtime-loaded low-frequency extraction rules, currently reachable by `v2` only through the legacy parser dependency | Patterns are still live at runtime and overlap conceptually with extraction heuristics that should eventually move to `patternCatalog` | If `patternCatalog` is added without emptying `patterns.json`, the same behavior will exist in two runtime stores | `server/data/patterns.json`, `server/engine/citationParser.ts`, `server/engine/v2/adapters.ts` |

### Five-State Migration Matrix

| Legacy capability | State | Why | Closure artifact |
|---|---|---|---|
| `strictRenderer.runAssertions` style assertions | partially ported | Active `v2` render uses it directly, but `v2` does not own a native equivalent yet | Strict-render mapping rows plus port queue item `P1-render-policy-extraction` |
| `strictRenderer.fixFormatting` post-CSL cleanup | partially ported | Active `v2` render uses it directly; punctuation-only cleanup is partly duplicated, but style-specific cleanup is still legacy-owned | Strict-render mapping rows plus port queue item `P1-render-policy-extraction` |
| `CitationParser.parseAuthorList()` heuristics | partially ported | `v2` has native author-parsing helpers, but deterministic extraction still routes through legacy author splitting in many cases | Port queue items `P0-author-family-hydration` and `P2-legacy-parser-exit` |
| `CitationParser.determineReferenceType()` soft scorer | partially ported | `v2` has `typeResolution.ts`, but legacy type scoring still influences deterministic parse branches | Port queue items `P0-style-source-drift` and `P2-legacy-parser-exit` |
| Legacy year recovery and candidate extraction helpers | partially ported | `v2` has some year logic in adapters and validation, but legacy recovery still participates in deterministic parsing | Port queue item `P2-legacy-parser-exit` |
| Dynamic pattern loader and watcher | still only in `v1` | The runtime store is still owned by legacy parser code even when `v2` reaches it indirectly | Patterns classification table and port queue item `P1-pattern-catalog-cutover` |
| `shared/computeRulesScore.ts` | should be dropped | This is frozen compatibility scoring for legacy output, not the operational `v2` quality model | Keep documented only; no `v2` migration item |
| `shared/confidence.ts` final legacy confidence | should be dropped | `v2` already uses `CitationQualityScore` for operational readiness; legacy confidence remains only for compatibility surfaces | Keep documented only; no `v2` migration item |
| Hot-reload pattern writer (`server/utils/patternWriter.ts`) | should be dropped | Hot-reloading JSON patterns is a legacy editing model that conflicts with an explicit `v2` pattern catalog | Review-gate sign-off only; no Phase B runtime carryover |
| Static year-cap bug behavior from legacy parsing | do not port | Static year regex/capping is exactly the kind of legacy heuristic debt `v2` should reject in favor of extracted value plus validation | `server/engine/v2/fixtures/doNotPortPhaseAStubs.ts` -> `legacy_static_year_cap` |
| `Place: Publisher` to `book` bias | do not port | Institutional and report citations must not be forced into `book` just because they have a place/publisher tail | `server/engine/v2/fixtures/doNotPortPhaseAStubs.ts` -> `legacy_place_publisher_book_bias` |
| ASCII-centric uppercase/initial parsing that mishandles non-ASCII names | do not port | `v2` should preserve diacritic-bearing surnames and not treat uppercase non-ASCII as disposable initials noise | `server/engine/v2/fixtures/doNotPortPhaseAStubs.ts` -> `legacy_non_ascii_initial_bias` |

### `strictRenderer.ts` Assertion-To-Coverage Mapping

Current status values in this table use the Phase A audit vocabulary:

- `covered in v2 render`
- `duplicated in v2 with different implementation`
- `absent from v2`
- `intentionally not needed in v2`
- `do not port`

Where a row is marked `covered in v2 render`, that currently means `v2` still gets the behavior by directly importing the legacy renderer.

| Legacy assertion / cleanup family | Current v2 status | Current owner in active path | Phase B action | Backed By |
|---|---|---|---|---|
| APA author inversion guard | covered in `v2` render | `render.ts` -> `runAssertions()` | Rehome into native `v2` render policy before legacy renderer deletion | `server/engine/v2/stages/render.ts`, `server/engine/strictRenderer.ts` |
| APA author particle handling | covered in `v2` render | `render.ts` -> `runAssertions()` | Rehome; keep paired with author-parser migration | `server/engine/strictRenderer.ts` |
| APA supplement / article-number formatting guard | covered in `v2` render | `render.ts` -> `runAssertions()` and `fixFormatting()` | Rehome with locator formatting policy | `server/engine/strictRenderer.ts` |
| APA hyphenated-initial preservation | covered in `v2` render | `render.ts` -> `runAssertions()` | Rehome with author formatting policy | `server/engine/strictRenderer.ts` |
| APA abbreviated-journal expansion warning | covered in `v2` render | `render.ts` -> `runAssertions()` and `fixFormatting()` | Decide whether to keep as warning-only or convert to normalize/render policy | `server/engine/strictRenderer.ts` |
| APA year format, no quotes, no `pp.`, no `Available at:` | covered in `v2` render | `render.ts` -> `runAssertions()` | Rehome as style-policy assertions | `server/engine/strictRenderer.ts`, `server/engine/strictRenderer.test.ts` |
| APA volume/issue punctuation guard | covered in `v2` render | `render.ts` -> `runAssertions()` | Rehome as assertion, not ad hoc string cleanup | `server/engine/strictRenderer.ts` |
| Harvard quote rules, `Available at:`, accessed date, `pp.`, year-in-parens | covered in `v2` render | `render.ts` -> `runAssertions()` and `fixFormatting()` | Rehome into native style-policy layer | `server/engine/strictRenderer.ts` |
| Chicago AD title/year/volume-no/terminal period guards | covered in `v2` render | `render.ts` -> `runAssertions()` | Rehome as assertion families | `server/engine/strictRenderer.ts` |
| Chicago NB year placement and no-immediate-year guard | covered in `v2` render | `render.ts` -> `runAssertions()` | Rehome as assertion families | `server/engine/strictRenderer.ts` |
| MLA title quotes, volume label, issue label, `pp.`, terminal period | covered in `v2` render | `render.ts` -> `runAssertions()` and `fixFormatting()` | Rehome as explicit MLA render policy | `server/engine/strictRenderer.ts` |
| MLA sentence case, Roman numeral restore, compact volume-issue-page reshaping, duplicate trailing-year cleanup | covered in `v2` render | `render.ts` -> `fixFormatting()` | Rehome into native MLA post-CSL cleanup; high risk if dropped | `server/engine/strictRenderer.ts`, `server/engine/strictRenderer.test.ts` |
| IEEE numbering, title quotes, `vol.`, `no.`, `pp.`, `Available:` cleanup | covered in `v2` render | `render.ts` -> `runAssertions()` and `fixFormatting()` | Rehome into native IEEE policy | `server/engine/strictRenderer.ts` |
| Vancouver `Year;Vol(Issue):Pages`, `[Internet]`, `[cited ...]`, `Available from:`, no `pp.` | covered in `v2` render | `render.ts` -> `runAssertions()` | Rehome into native Vancouver policy | `server/engine/strictRenderer.ts` |
| Universal placeholder-text check (`Unknown Title`, `Unknown Author`) | covered in `v2` render | `render.ts` -> `runAssertions()` | Keep, but align with `v2` bucket policy so render warnings do not drift from score semantics | `server/engine/strictRenderer.ts` |
| Universal missing-locator warning derived from `_inputHadLocator` | covered in `v2` render | `render.ts` -> `runAssertions()` | Reconcile with `validate.ts` locator logic to avoid split ownership | `server/engine/strictRenderer.ts`, `server/engine/v2/stages/validate.ts` |
| Markdown-link stripping | covered in `v2` render | `render.ts` -> `fixFormatting()` | Rehome into native post-CSL cleanup | `server/engine/strictRenderer.ts` |
| DOI angle-bracket stripping | covered in `v2` render | `render.ts` -> `fixFormatting()` | Rehome into native post-CSL cleanup | `server/engine/strictRenderer.ts` |
| `& et al.` cleanup | covered in `v2` render | `render.ts` -> `fixFormatting()` | Rehome into native post-CSL cleanup | `server/engine/strictRenderer.ts` |
| Journal abbreviation expansion dictionary | covered in `v2` render | `render.ts` -> `fixFormatting()` | Decide whether to keep in render or move to normalize; do not drop silently | `server/engine/strictRenderer.ts` |
| APA publisher-location removal | covered in `v2` render | `render.ts` -> `fixFormatting()` | Rehome into native APA style policy | `server/engine/strictRenderer.ts` |
| APA structured conference / chapter rebuild from parsed fields | covered in `v2` render | `render.ts` -> `fixFormatting()` | Rehome into native render policy or pre-render canonicalization | `server/engine/strictRenderer.ts` |
| Generic duplicate punctuation, space-before-punctuation, terminal period enforcement | duplicated in `v2` with different implementation | `postCslCleanup()` and `sanitizeCitation()` in `render.ts`, plus legacy `fixFormatting()` | Keep one canonical owner in Phase B; do not leave both cleanup layers diverging | `server/engine/v2/stages/render.ts`, `server/engine/strictRenderer.ts` |

### `patterns.json` Entry Classification

Every current `patterns.json` entry must leave Phase B through one of these paths:

- deleted because it is redundant or legacy-only
- promoted into `patternCatalog`
- explicitly rejected as `do not port`

`patterns.json` must be empty before Phase B closes.

| Pattern ID | Classification | Reason / overlap | Backed By |
|---|---|---|---|
| `volume-issue-hyphen` | promote to `patternCatalog` | Still useful low-frequency extraction shape; currently owned only by runtime-loaded legacy patterns | `server/data/patterns.json`, `server/engine/citationParser.ts` |
| `volume-issue-no-label` | promote to `patternCatalog` | Useful for compact locator tails that are not owned cleanly elsewhere | `server/data/patterns.json`, `server/engine/citationParser.ts` |
| `vol-issue-abbrev` | promote to `patternCatalog` | Still useful abbreviation-driven extraction shape | `server/data/patterns.json`, `server/engine/citationParser.ts` |
| `volume-issue-words` | `v1`-only and deleting | Duplicate alias of `volume-issue-hyphen`; should collapse rather than survive as a second runtime rule | `server/data/patterns.json` |
| `vol-issue-parens` | promote to `patternCatalog` | Distinct compact volume/issue signal still worth preserving if no native parser rule replaces it | `server/data/patterns.json`, `server/engine/citationParser.ts` |
| `vol-no` | `v1`-only and deleting | Functional duplicate of `vol-issue-abbrev`; delete once catalog normalization lands | `server/data/patterns.json` |
| `simple-vol-issue-pages` | `v1`-only and deleting | Functional duplicate of `volume-issue-no-label`; keep only one canonical catalog rule | `server/data/patterns.json` |
| `mla-chicago-vol-no-year` | promote to `patternCatalog` | Source-style-specific year recovery still belongs to pattern ownership if retained | `server/data/patterns.json`, `server/engine/citationParser.ts` |
| `chicago-year-in-parenthesized-locator-tail` | promote to `patternCatalog` | Distinct tail-shape recovery rule that should not stay as ad hoc JSON forever | `server/data/patterns.json` |
| `uppercase-article-locator` | promote to `patternCatalog` | Still useful raw extraction rule even though locator classification exists later in `v2` | `server/data/patterns.json`, `server/engine/v2/qualityRules.ts` |
| `bare-article-locator` | promote to `patternCatalog` | Still useful raw extraction rule; keep explicit ownership instead of implicit legacy reachability | `server/data/patterns.json`, `server/engine/v2/qualityRules.ts` |
| `trailing-year-parens` | `v1`-only and deleting | Generic year recovery should be owned by parser/adapters, not left as a trailing catch-all pattern file rule | `server/data/patterns.json`, `server/engine/citationParser.ts` |

### Phase A `do not port` Stub Artifacts

The following Phase A fixture stubs exist so `do not port` decisions can close without pretending the final replacement tests already exist:

- [doNotPortPhaseAStubs.ts](/D:/Coding/Citing/server/engine/v2/fixtures/doNotPortPhaseAStubs.ts)

These stubs are committed classification artifacts, not passing regressions. They must become real passing tests before Phase D legacy deletion.

## Port Queue

### Queue Rules

- Queue entries are ordered by migration value to active `v2`, not by legacy file size.
- `should be dropped` and `do not port` items cannot move into Phase B implementation until the review gate is closed.
- Shared-stage changes follow the rerun rules from `AGENTS.md`, not just the single failing fixture that exposed the gap.

### P0 Queue

- [ ] `P0-split-boundary-stability`
  State: `partially ported`
  Behavior: Restore stable split behavior for real PDF-copy and continuous pasted-text boundaries without regressing numbered or raw corpuses.
  Source file: [server/engine/v2/rawPdfCopy.ts](/D:/Coding/Citing/server/engine/v2/rawPdfCopy.ts), [server/engine/v2/stages/split.ts](/D:/Coding/Citing/server/engine/v2/stages/split.ts)
  Target `v2` module: same modules; no legacy import should be needed for the fix path
  Test requirement: make the existing split contamination fixture pass at 8 citations; keep PDF-copy and numbered stress fixtures green
  Rerun scope: `split-contamination.test.ts`, `rawPdfCopy.test.ts`, `numbered-bibliography-split.test.ts`, `real-world-batches.test.ts`, `real-world-450.test.ts`
  Notes / closure condition: the `runtime probe: split-pdf-copy-count-20260328` mismatch must disappear, and cross-suite reruns must still pass

- [ ] `P0-author-family-hydration`
  State: `partially ported`
  Behavior: Stop duplicate-family merges from preserving malformed author fragments and make family canonicalization depend on stable author structure
  Source file: [server/engine/v2/stages/dedup.ts](/D:/Coding/Citing/server/engine/v2/stages/dedup.ts), [server/engine/v2/adapters.ts](/D:/Coding/Citing/server/engine/v2/adapters.ts)
  Target `v2` module: author parsing and dedup family hydration inside `v2`
  Test requirement: Baron and Jensen regression fixtures must produce merged authors with canonical surnames only
  Rerun scope: `regression-pack.test.ts`, `real-world-batches.test.ts`, `enrich-validate-dedup.test.ts`
  Notes / closure condition: `runtime probe: duplicate-family-authors-20260328` should no longer show `Reuben` / `David`-style fragment authors in merged output

- [ ] `P0-style-source-drift`
  State: `partially ported`
  Behavior: Resolve current style/source drift where website and book/report cases still fall into the wrong family
  Source file: [server/engine/v2/stages/detect.ts](/D:/Coding/Citing/server/engine/v2/stages/detect.ts), [server/engine/v2/adapters.ts](/D:/Coding/Citing/server/engine/v2/adapters.ts), [server/engine/v2/typeResolution.ts](/D:/Coding/Citing/server/engine/v2/typeResolution.ts)
  Target `v2` module: detect and extract/type resolution in `v2`
  Test requirement: current failing style/source regression fixtures must pass, especially MLA website, Chicago book, and Harvard website
  Rerun scope: `style-source-regression.test.ts`, `regression-pack.test.ts`, `real-world-batches.test.ts`
  Notes / closure condition: `runtime probe: style-source-drift-20260328` should become empty for the audited fixture set

### P1 Queue

- [ ] `P1-render-policy-extraction`
  State: `partially ported`
  Behavior: Replace direct legacy `strictRenderer` ownership with a native `v2` render-policy/assertion module without losing current output guards
  Source file: [server/engine/strictRenderer.ts](/D:/Coding/Citing/server/engine/strictRenderer.ts), [server/engine/v2/stages/render.ts](/D:/Coding/Citing/server/engine/v2/stages/render.ts)
  Target `v2` module: new native render policy module under `server/engine/v2/`
  Test requirement: preserve the assertion-family mapping documented above and keep render-facing suites green
  Rerun scope: `strictRenderer.test.ts`, `strictRenderer.edge.test.ts`, `pipeline.test.ts`, `style-source-regression.test.ts`, `real-world-batches.test.ts`, `real-world-450.test.ts`
  Notes / closure condition: every strict-render row must be either natively rehomed or explicitly marked intentionally unneeded before legacy renderer deletion

- [ ] `P1-pattern-catalog-cutover`
  State: `still only in v1`
  Behavior: Move retained `patterns.json` behavior into an explicit `v2` pattern catalog and empty the runtime JSON store
  Source file: [server/data/patterns.json](/D:/Coding/Citing/server/data/patterns.json), [server/engine/citationParser.ts](/D:/Coding/Citing/server/engine/citationParser.ts)
  Target `v2` module: new `patternCatalog` under `server/engine/v2/`
  Test requirement: each promoted pattern must have a named consumer test or fixture owner; duplicate alias rules must be collapsed rather than copied 1:1
  Rerun scope: `regression-pack.test.ts`, `style-source-regression.test.ts`, `pipeline.test.ts`, and any targeted extraction fixtures affected by the migrated patterns
  Notes / closure condition: `patterns.json` is empty by the end of Phase B and no overlapping runtime rule store remains

- [ ] `P1-enrich-vocabulary-alignment`
  State: `already in v2`
  Behavior: Align product/test vocabulary around `skipped`, `unverifiable`, and `provider_no_coverage` so the active path and the tests describe the same lifecycle
  Source file: [server/engine/v2/stages/enrich.ts](/D:/Coding/Citing/server/engine/v2/stages/enrich.ts), [server/engine/v2/pipeline.test.ts](/D:/Coding/Citing/server/engine/v2/pipeline.test.ts)
  Target `v2` module: enrich metadata vocabulary and tests
  Test requirement: the active path assertion in `pipeline.test.ts` must match actual enrich semantics
  Rerun scope: `pipeline.test.ts`, `enrich-stage.test.ts`, `validation-false-positives.test.ts`
  Notes / closure condition: `runtime probe: enrich-source-used-20260328` and test expectations agree on status naming

### P2 Queue

- [ ] `P2-legacy-parser-exit`
  State: `partially ported`
  Behavior: Pull the still-useful parser behaviors out of legacy ownership and make `v2` explicit about which author parsing, type scoring, and year recovery rules it keeps
  Source file: [server/engine/citationParser.ts](/D:/Coding/Citing/server/engine/citationParser.ts), [server/engine/v2/adapters.ts](/D:/Coding/Citing/server/engine/v2/adapters.ts)
  Target `v2` module: explicit parser-support modules under `server/engine/v2/`
  Test requirement: each retained behavior must be covered by an existing passing fixture or a newly added migration fixture; each rejected behavior must reference a Phase A `do not port` stub
  Rerun scope: `regression-pack.test.ts`, `style-source-regression.test.ts`, `fixtures/operationalAccuracyCorpus.ts` consumers, `real-world-batches.test.ts`
  Notes / closure condition: the audit matrix is updated from `partially ported` to either native `v2` ownership or explicit rejection for each audited parser behavior

- [ ] `P2-score-policy-centralization`
  State: `already in v2`
  Behavior: Externalize score caps, thresholds, and downgrade policy into a single `v2` policy artifact without weakening current bucket behavior
  Source file: [server/engine/v2/stages/score.ts](/D:/Coding/Citing/server/engine/v2/stages/score.ts), [server/engine/v2/qualityRules.ts](/D:/Coding/Citing/server/engine/v2/qualityRules.ts)
  Target `v2` module: dedicated score policy module or config
  Test requirement: baseline values and bucket reasons stay stable on current false-positive and real-world suites
  Rerun scope: `validation-false-positives.test.ts`, `real-world-batches.test.ts`, `real-world-450.test.ts`, `scripts/v2PhaseBaseline.ts`
  Notes / closure condition: threshold changes become auditable and cross-suite reruns can point at one policy table

### Review Gate

Named actor:

- repo owner / reviewer for the `v2` migration

Named artifact:

- this audit document

Named closure action:

- a documentation-only commit or PR that updates every `should be dropped` and `do not port` row with `reviewed: YYYY-MM-DD`

Review-gate rules:

- the review commit or PR must contain no implementation code
- it must contain no non-audit feature changes
- if Phase B code appears in the same commit or PR that changes review state, the sequencing rule was violated

### Sequencing

Phase A:

- complete this audit
- add Phase A `do not port` stubs
- stop before implementation

Phase B:

- work only from the approved Port Queue
- empty `patterns.json` before the phase closes

Phase C:

- finish remaining queue items and remove legacy ownership that is no longer needed

Phase D:

- replace all Phase A stub-only `do not port` artifacts with real passing regression tests or approved replacement proof
- only then delete the remaining legacy ownership surfaces
