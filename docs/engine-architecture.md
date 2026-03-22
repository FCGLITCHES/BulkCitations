# Engine Architecture

## Scope

This document describes the **v2 citation engine**, which is the system we are actively improving.

There is still a legacy `/api/convert` surface for the website, but that route now mainly acts as a **bridge into v2** when `engineVersion = "v2"`. The core architecture worth understanding is therefore the v2 pipeline, not the legacy v1 parser.

## Current Status

As of `2026-03-22`, the current v2 architecture has already absorbed several important reliability changes:

- `enrich` is now a strict resolution-and-repair stage, not a passive metadata check
- `split`, `detect`, `extract`, `enrich`, `normalize`, `validate`, `truth`, `dedup`, `score`, and `render` now all use per-item isolation so one stalled or broken citation does not fail the whole batch
- the pipeline now records wall-clock timing for every stage and exposes both `stageTimings` and a `slowestStages` view in `processingPath`, so performance tuning can target real phase costs instead of guesses
- `dedup` does not just create a merged canonical citation anymore; duplicate-family members are also hydrated from the family canonical record and revalidated
- `validate` is intentionally post-repair and offline in the strict-resolution path
- `extract` now has deterministic rescue coverage for quoted-title journal tails such as `BMJ 372 (2021): n71` and `Journal ... 51, no. 6 (1986): 1173-1182`
- CPU-bound bulk stages such as `detect`, `normalize`, `score`, and `render` now use lighter sequential item isolation instead of per-item async timeout wrappers, and `extract` takes the same fast path when GROBID and LLM extraction are both off
- `score` can keep locally strong citations in `ready` even when provider verification fails, and a strongly verified citation is no longer blocked only because the venue field stayed missing
- provider source-type normalization has broader coverage for labels such as `working-paper`, `dissertation`, `edited-book`, `reference-entry`, and `proceedings-article`, so query routing and verified type upgrades are less brittle
- CSL rendering now reuses template-scoped formatter instances instead of allocating a fresh `citation-js` wrapper per citation, which materially reduced render-phase cost without changing formatted output
- `truth` now resolves against an in-memory active-truth index instead of reloading and rescanning the full store for every citation
- `extract` can now skip fallback and institutional reparsing for already-strong deterministic candidates, which cuts CPU time without changing the verification rules
- the default debug path is now compact by design: structured debug logging is off unless explicitly enabled, verbose stage payloads require `V2_DEBUG_VERBOSE=1`, and the legacy bridge strips repeated per-citation processing-path arrays and `inputProfile` in normal mode
- the website now defaults new sessions to `v2`, preloads the results view while a conversion is running, defers PDF code until export time, defers bulk result props into the heavy output tree, memoizes per-citation confidence and row rendering, and avoids a duplicate-selection sync render on initial results load

That combination is what made the latest 500-reference enrich/validate/dedup stress run land at `487/500 ready` (`97.4%`).

## Why These Changes Were Added

These changes were added for a simple architectural reason: the engine was already doing expensive, high-value work, but it was not always allowed to fully use that work downstream.

- `enrich` was upgraded because verification that does not repair fields is too weak. If the engine proves the correct authority record, keeping the wrong extracted fields would make verification decorative instead of operational.
- per-item stage isolation was expanded across the pipeline because a single stalled citation should never be able to invalidate a bulk run. The engine needs local recovery, not batch-wide collapse.
- once that isolation existed everywhere, the CPU-bound stages were switched to lighter sequential recovery boundaries because JavaScript timeouts do not actually preempt synchronous formatter/parser work. That preserved the failure model while removing avoidable promise and timer overhead.
- `validate` was moved into a clearly post-repair role because validating the pre-repair parse produces false positives the engine has already earned the right to remove.
- duplicate-family hydration was added because once dedup proves multiple citations are the same work, leaving one merged citation clean and the duplicate members dirty creates an inconsistent family state and pollutes downstream scoring and review.
- extractor venue-tail rescue was expanded because a parser that gets the title right but swallows the venue, volume, or issue still damages dedup, validation, and rendering downstream.
- the newer `score` ready paths were added because provider instability is not the same thing as citation unreliability. When the local parse is strong and the only unresolved problem is external verification failure or a non-critical missing venue on an otherwise verified citation, the bucket should reflect citation quality rather than network luck.
- stage timing telemetry was added because performance work should be driven by measured phase cost. The engine now reports which stages were actually slowest for a given job.
- provider source-type normalization was expanded because external authorities do not agree on one small type vocabulary. If those labels are not normalized well, we lose both recall and safe type upgrades after a verified match.
- the truth stage was indexed because exact alias matching should be O(1)-style lookup work during a batch, not repeated full-store scans.
- deterministic extract short-circuiting was added because once a parse is already clean on title, authors, year, venue, locator, and type, paying for extra reparsing paths does not improve quality often enough to justify the cost.
- the default debug payload was slimmed because the stress harness and the browser were both paying to build large debug objects that normal user flows do not read.
- the website bridge and results view were slimmed because the UI should not pay bundle, payload, and rerender costs for per-citation metadata or list churn it is not actively showing during normal conversion flows.

The general principle is:

- be permissive at the input edge
- be strict when proving identity
- be conservative when overwriting fields
- and once something is verified, let the rest of the engine benefit from that proof

## Design Goals

The engine is built around a few non-negotiable ideas:

- accept messy real-world reference input instead of assuming clean bibliography strings
- preserve provenance, confidence, and stage-level diagnostics for every important field
- separate parsing, resolution, validation, deduplication, and rendering so each phase can be tested independently
- prefer **systematic stage fixes** over citation-by-citation exceptions
- let verified external authority records **repair** citations, not merely comment on them

## Core Model

The v2 engine works on a `CanonicalCitation` object. That object carries:

- the raw citation text
- canonical bibliographic fields such as `authors`, `title`, `year`, `journal`, `pages`, `doi`, `url`
- a `referenceType`
- per-field provenance:
  - `source`
  - `confidence`
  - `stageId`
- stage metadata:
  - `split`
  - `extraction`
  - `resolution`
  - `normalization`
  - `validation`
  - `duplicate`
  - `enrichment`
  - `quality`
  - `rendered`
- stage debug and stage logs

That model is the reason the engine can explain *why* something was marked `ready`, `worth_reviewing`, or `action_needed` instead of only returning a formatted string.

## Pipeline Order

The active v2 stage order is:

1. `ingest`
2. `split`
3. `detect`
4. `extract`
5. `enrich`
6. `normalize`
7. `validate`
8. `truth`
9. `dedup`
10. `group`
11. `score`
12. `render`
13. `respond`

That order matters. The main architectural idea is:

- first decide what the input blob looks like
- then isolate citation chunks
- then detect likely style
- then extract fields
- then verify and repair with authority data
- then normalize the repaired citation
- then validate the repaired citation
- then deduplicate and score the final canonical form

## Stage Reliability Model

The v2 engine now treats most bulk-stage work as **item-isolated** rather than batch-atomic.

- `split`, `detect`, `extract`, `enrich`, `normalize`, `validate`, `truth`, `dedup`, `score`, and `render` all run each citation or citation-group task behind a per-item timeout and recovery boundary
- CPU-bound stages now prefer sequential recovery loops to async timeout wrappers, while network-sensitive stages such as `enrich` still use concurrency plus timeout control where that isolation is operationally meaningful
- stage-level timeouts are scaled from estimated work units, per-item budgets, and concurrency so the stage budget grows with batch size instead of acting like a small fixed ceiling
- a timed out or crashed item is downgraded into local fallback output plus stage diagnostics, instead of aborting the whole response
- the pipeline also records per-stage wall time, estimated work units, and timeout budgets so we can see not just that a stage failed or succeeded, but how expensive it was when it ran

This changes the failure model in an important way: the pipeline still surfaces partial-result warnings, but "one bad reference crashes the whole upload" is no longer the default behavior for bulk v2 runs.

## Stage Breakdown

### 1. `ingest`

**Purpose**

- classify the incoming payload as text, DOI list, structured, semi-structured, unstructured, or mixed
- estimate citation count and major input signals

**What it is good at**

- giving later stages realistic expectations about what kind of mess they are dealing with
- improving timeout and concurrency planning

**Current gaps**

- input profiling is strong enough for routing, but not yet the main tuning focus

### 2. `split`

**Purpose**

- turn one raw blob into citation-sized chunks
- detect contamination such as headers, orphan DOI lines, multiline truncation, and embedded second references

**What it is good at**

- producing a working chunk even when the raw input is imperfect
- surfacing contamination diagnostics instead of silently pretending the chunk is clean

**Current gaps**

- still vulnerable to highly pathological OCR or document extraction noise
- works best when the input preserves some structure, even if that structure is weak

### 3. `detect`

**Purpose**

- estimate likely citation style for each chunk

**What it is good at**

- providing extractor hints for mixed APA / Vancouver / IEEE / Harvard-like inputs

**Current gaps**

- detect-family confusion analysis is intentionally deferred right now
- detection is helpful, but extraction quality still matters more than label purity

### 4. `extract`

**Purpose**

- turn a citation string into canonical fields
- choose between deterministic, fallback, institutional, GROBID, and optional LLM-assisted extraction paths

**What it is good at**

- handling many real-world citation variants without needing one parser per style
- preserving field confidence and rejection reasons
- catching author-blob failures and venue/title leakage
- rescuing quoted-title journal tails before the generic parser can swallow locators or venue text into the wrong field

**Current gaps**

- extractor edge-case ranking is deferred for later
- this remains the biggest source of residual misses once split is stable

### 5. `enrich`

**Purpose**

- perform strict external resolution
- decide whether an external candidate is truly the same citation
- apply verified authority fields back into the citation

**How it works**

- minimum evidence gate first
- provider order is type-aware
- candidates are fetched in small batches
- candidates are scored locally
- only strict verified matches are accepted
- verified fields are merged into the citation
- provider-specific source-type labels are normalized before compatibility checks and before any verified type upgrade is applied

**Why this stage exists**

This is the engine’s “trust but verify” layer. Extraction is best-effort. `enrich` is the place where we decide whether outside metadata is good enough to become corrective authority.

**What it is good at**

- replacing first-hit enrichment with strict resolution
- backfilling and correcting missing or wrong fields
- recording `appliedFields` separately from unresolved `conflictFields`
- avoiding silent overwrites of user-sourced fields
- reusing in-flight lookups across duplicate-style variants
- isolating slow provider calls so a single stuck citation does not timeout the whole stage
- broadening provider type coverage without exploding our canonical citation-type taxonomy

**Current gaps**

- remaining misses are mostly coverage or exact-match ranking misses, not merge-conflict noise
- provider recall still varies by citation type
- provider instability can still reduce verification coverage, but it should no longer collapse the whole stage

## Performance Telemetry

Every v2 response now carries phase timing data in `processingPath`:

- `stageTimings` preserves one timing record per stage with `stageId`, `status`, `durationMs`, `workUnits`, and `timeoutMs`
- `slowestStages` is the same data sorted from longest to shortest so stress tooling and profiling can immediately surface the dominant bottlenecks

That telemetry is intentionally operational rather than decorative. It exists so we can tune the actual expensive stages first, confirm that optimizations change the right part of the pipeline, and avoid trading citation quality for speed based on intuition alone.

The first concrete win from that telemetry was the render path. Once timings showed `render` dominating the 250-case SDE batch, the engine switched from per-citation `new Cite(...)` allocation to reusable template-scoped formatter instances. On the SDE stress harness that dropped render time from roughly `1403ms` to `674ms` and reduced whole-job runtime from `2124ms` to `1455ms` while keeping the same accuracy outputs.

The next optimization pass targeted `truth`, `extract`, and the website bridge:

- `truth` now builds a short-lived active-truth alias index so fingerprint, DOI, and work-key matches no longer rescan the whole store for every citation
- `extract` now skips year-anchored and institutional candidate construction when the deterministic parse is already clearly strong for citation types where that shortcut is safe
- the `/api/convert` v2 bridge now keeps only non-success stage-log summaries in normal mode, which reduces response size and client-side object churn
- the site defaults fresh users to `v2`, preloads the heavy results component during processing, and lazy-loads `jspdf` only when the user actually exports a PDF

The latest optimization pass tightened the remaining hot loops instead of changing citation behavior:

- `detect`, `normalize`, `score`, and `render` now use the lighter sequential isolation path, and deterministic-only `extract` follows that same model
- `strictRenderer` now reuses precompiled regexes and cheap guard checks instead of rebuilding replacement patterns on every citation
- `runAssertions` now computes counts in one pass instead of repeatedly filtering the same detail list
- `extract` debug payloads reuse the parsed object directly instead of rebuilding selected-field clones for every citation
- the legacy bridge now omits repeated processing-path arrays and repeated `inputProfile` data for each citation unless debug mode is explicitly enabled
- the results view memoizes citation rows and confidence badges, passes per-row booleans instead of whole shared maps/sets, and no longer performs a post-render duplicate-selection synchronization pass

On the 250-case SDE harness, those changes brought the debug-on batch from the earlier `1705ms` recovery point down to about `1188ms` while preserving the same summary accuracy (`style 0.508`, `reference type 0.428`, `field 0.4755`). The same harness now runs at about `1159ms` with `debug: false`, which is closer to the actual site execution path.

### 6. `normalize`

**Purpose**

- clean and standardize already-extracted and already-enriched fields

**Examples**

- DOI normalization
- mojibake repair
- locator cleanup
- page-range repair
- unicode cleanup
- field-level text normalization

**What it is good at**

- making later validation and comparison logic much more reliable
- preventing trivial formatting differences from looking like semantic conflicts

**Current gaps**

- normalization is additive and conservative by design, so some ugly source strings still survive if the engine cannot safely rewrite them

### 7. `validate`

**Purpose**

- run offline plausibility checks on the post-normalization, post-enrich citation

**What it checks**

- required fields by source type
- malformed author structure
- impossible year ranges
- placeholder venue/volume values
- protected-token corruption
- embedded second-reference signatures
- split contamination evidence

**Why it matters**

Validation is not just “did extraction succeed?” It asks whether the citation still looks structurally believable after all repair steps.

**What it is good at**

- catching parser lies
- producing interpretable validation codes
- staying offline for non-DOI checks in the v2 strict-resolution path
- distinguishing real citation problems from external-provider failures
- avoiding false blocking on citations whose identity is already strongly verified even if a venue field could not be recovered

**Current gaps**

- must remain tightly controlled to avoid false positives
- every new validation rule needs regression coverage, because validate is very easy to make too noisy

### 8. `truth`

**Purpose**

- apply approved ground-truth corrections from the reporting workflow when they exist

**What it is good at**

- letting verified human corrections survive future parser changes

**Current gaps**

- not the main tuning target in the current cycle

### 9. `dedup`

**Purpose**

- identify duplicate citations and merge them into a stronger canonical record

**How it works**

- DOI matches are strongest
- structural matches are used when DOI is absent
- the strongest citation becomes the base
- the strongest field wins during merge
- merged citations are revalidated
- duplicate-family members can inherit the merged family’s repaired canonical fields
- hydrated duplicate members are revalidated before scoring

**What it is good at**

- collapsing duplicate families without losing the best available field values
- preserving authority-backed fields during merge
- rerunning validation after merge so stale pre-merge warnings do not leak through
- preventing a clean merged family record from sitting next to several still-broken duplicate siblings

**Important recent change**

- structural dedup is now blocked when two citations have **different explicit DOIs**
- duplicate members now inherit the merged family citation’s strongest safe fields instead of only being marked as duplicates

**Current gaps**

- dedup still needs to stay conservative, because false-positive merging is worse than a missed duplicate

### 10. `group`

**Purpose**

- optional higher-level grouping of related citations

**Current status**

- implemented but currently disabled by default in the v2 runtime config
- not the present tuning focus

### 11. `score`

**Purpose**

- convert field confidence, validation state, resolution state, and duplicate state into:
  - `overall`
  - `grade`
  - `flags`
  - `bucket`
  - `bucketReasons`

**Buckets**

- `ready`
- `worth_reviewing`
- `action_needed`

**What it is good at**

- combining local parse quality and authority evidence into one review decision
- allowing local-ready paths for source types with poor provider coverage
- preventing high-confidence citations from dropping out of `ready` just because a provider timed out
- allowing a strongly verified citation to remain `ready` when the only unresolved gap is a missing venue field
- treating short-but-valid report titles and acronym venues such as `BMJ`, `WHO`, or `AIHW` as substantive enough for clean local-ready paths

**Current gaps**

- score is only as honest as the phases before it
- if extraction lies cleanly, scoring can still look confident unless validate catches it

### 12. `render`

**Purpose**

- format the canonical citation into the requested output style
- attach renderer warnings and assertion summaries

**What it is good at**

- separating formatting concerns from parsing and repair
- giving the UI a formatted citation plus warning metadata
- preserving article locators verbatim in styles like APA, so outputs such as `Article n71` and `Article e1000097` keep the meaningful prefix instead of stripping it

**Current gaps**

- renderer correctness still depends on canonical field correctness upstream

### 13. `respond`

**Purpose**

- package the final v2 response
- build exports and stats
- emit the citation list, duplicates, groups, debug payload, and processing path

## Why The Recent `enrich`, `validate`, And `dedup` Changes Matter

### `enrich`

The biggest architectural upgrade was changing `enrich` from a soft metadata lookup into a **strict resolution and repair phase**.

Before:

- external metadata mostly acted like a side comment
- the engine could “know” the right answer and still keep the wrong extracted fields

Now:

- once the resolver proves a candidate is the same citation, authority fields can repair the canonical citation
- the system records exactly what got changed
- if a provider call stalls, that single citation is downgraded to a provider error instead of hanging the whole batch

That is a better design because it turns verification into something operational, not decorative.

It was also changed this way because stage-level reliability matters just as much as candidate quality. A strict resolver that can still lose the whole batch to one hung provider is not production-safe, so `enrich` now isolates slow citations instead of letting them poison the full run.

### `validate`

The validate stage was made intentionally **post-repair** and **offline** for the v2 path.

That matters because validation should answer:

- “what does the final canonical citation look like?”

not:

- “what did the first raw extraction look like before authority repair?”

This change reduced a very common false positive pattern where a citation stayed noisy even after the engine had enough evidence to fix it.

It was also necessary so validation could become more honest about the difference between:

- a citation that is structurally bad
- and a citation that is structurally good but externally unverifiable at that moment

Validation is now also careful not to treat "missing venue" as a blocking error when the citation identity is already strongly verified. In that case the missing venue is still recorded, but it is informational rather than disqualifying.

### `dedup`

Dedup now behaves like a canonicalization phase, not just a clustering phase.

That matters because once duplicates are detected, the merge result becomes a new citation that must be:

- field-selected intelligently
- revalidated
- scored on its own merits

This is why dedup now prefers authority-backed fields, reruns validation after merge, and hydrates duplicate-family members from the merged canonical record so the family does not stay internally inconsistent.

That hydration step was added because duplicate handling is not finished once a merged citation exists. If the family is known to represent the same work, the duplicate members should not keep dragging review metrics down with stale partial fields that the family has already corrected.

### `score`

`score` was expanded to recognize clean unresolved cases because strict verification is valuable, but provider behavior is still imperfect.

The reason for this change was not to make scoring looser in general. It was to make scoring more faithful to reality:

- poor citation quality should still be blocked
- malformed extraction should still be blocked
- missing required fields should still be blocked
- but clean, high-confidence citations should not be punished purely because Crossref or OpenAlex failed to answer in time
- and a citation that is otherwise strongly verified should not fall out of `ready` only because no venue string was recovered

## Website Input Path

The main website used to pre-split text on the client and send `references[]` to `/api/convert`.

That created a brittle failure mode:

- the UI could reject or mis-shape the input before v2 ever saw it

The site now has a better path for v2:

- raw pasted content can be sent through the legacy bridge as `content`
- the bridge passes that raw blob into the v2 engine

This is the right architectural boundary because user input should be flexible, while canonical field constraints should still stay strict *inside* the engine.

## Website v2 UX Notes

The website now treats v2 engine output as the source of truth for confidence messaging and recheck behavior.

- the confidence breakdown text is expected to explain what is actually limiting confidence, such as weak input evidence, unresolved required fields, or partial-result recovery, instead of showing a generic parsing-only disclaimer
- the legacy recheck action is intentionally disabled for v2 citations because replaying the older path was making some already-good v2 outputs worse

## What Is Currently Strong

- stage separation is clear
- stage logs and debug metadata are good enough to tune systematically
- strict resolution is materially better than first-hit enrichment
- authority-applied field repair is now real
- provider stalls no longer have to become stage-level or item-family failures across the main bulk stages
- dedup is more conservative in the presence of conflicting DOI evidence
- dedup now strengthens duplicate-family members instead of only tagging them
- local-ready logic for reports / books / websites is much more realistic than before
- local-ready logic now also handles clean provider-error cases and verified-missing-venue cases more gracefully

## Main Known Gaps

- detect-family ranking is still deferred
- source-type misclassification ranking is still deferred
- extractor field-loss ranking is still deferred
- provider coverage and exact-match recall are still the main reason some good citations land in `worth_reviewing`
- extractor corruption is now the main cause of true `action_needed` cases on the latest stress runs
- some truncated or severely corrupted raw citations still cannot be safely recovered

## Practical Rule Of Thumb

If the engine is wrong, ask these questions in order:

1. Did `split` isolate the right citation?
2. Did `extract` put the right text into the right fields?
3. Did `enrich` verify the correct external record?
4. Did `normalize` preserve the citation while cleaning it?
5. Did `validate` correctly distinguish real structural problems from harmless variation?
6. Did `dedup` merge only true duplicates?
7. Did `score` bucket the final citation based on the repaired state rather than the raw one?

That is the intended operating model for debugging the v2 engine.
