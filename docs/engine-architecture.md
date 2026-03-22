# Engine Architecture

## Scope

This document describes the **v2 citation engine**, which is the system we are actively improving.

There is still a legacy `/api/convert` surface for the website, but that route now mainly acts as a **bridge into v2** when `engineVersion = "v2"`. The core architecture worth understanding is therefore the v2 pipeline, not the legacy v1 parser.

## Current Status

As of `2026-03-22`, the current v2 architecture has already absorbed several important reliability changes:

- `enrich` is now a strict resolution-and-repair stage, not a passive metadata check
- `enrich` has a per-citation timeout guard, so one stalled provider lookup does not fail the whole batch
- `dedup` does not just create a merged canonical citation anymore; duplicate-family members are also hydrated from the family canonical record and revalidated
- `validate` is intentionally post-repair and offline in the strict-resolution path
- `score` can keep locally strong citations in `ready` even when provider verification fails, as long as the only remaining unresolved signal is a benign provider miss

That combination is what made the latest 500-reference enrich/validate/dedup stress run land at `487/500 ready` (`97.4%`).

## Why These Changes Were Added

These changes were added for a simple architectural reason: the engine was already doing expensive, high-value work, but it was not always allowed to fully use that work downstream.

- `enrich` was upgraded because verification that does not repair fields is too weak. If the engine proves the correct authority record, keeping the wrong extracted fields would make verification decorative instead of operational.
- the per-citation `enrich` timeout was added because a single stalled provider call should never be able to invalidate an entire batch run. The engine needs failure isolation, not batch-wide collapse.
- `validate` was moved into a clearly post-repair role because validating the pre-repair parse produces false positives the engine has already earned the right to remove.
- duplicate-family hydration was added because once dedup proves multiple citations are the same work, leaving one merged citation clean and the duplicate members dirty creates an inconsistent family state and pollutes downstream scoring and review.
- the newer `score` ready paths were added because provider instability is not the same thing as citation unreliability. When the local parse is strong and the only unresolved problem is external verification failure, the bucket should reflect citation quality rather than network luck.

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

**Why this stage exists**

This is the engine’s “trust but verify” layer. Extraction is best-effort. `enrich` is the place where we decide whether outside metadata is good enough to become corrective authority.

**What it is good at**

- replacing first-hit enrichment with strict resolution
- backfilling and correcting missing or wrong fields
- recording `appliedFields` separately from unresolved `conflictFields`
- avoiding silent overwrites of user-sourced fields
- reusing in-flight lookups across duplicate-style variants
- isolating slow provider calls so a single stuck citation does not timeout the whole stage

**Current gaps**

- remaining misses are mostly coverage or exact-match ranking misses, not merge-conflict noise
- provider recall still varies by citation type
- provider instability can still reduce verification coverage, but it should no longer collapse the whole stage

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

## Website Input Path

The main website used to pre-split text on the client and send `references[]` to `/api/convert`.

That created a brittle failure mode:

- the UI could reject or mis-shape the input before v2 ever saw it

The site now has a better path for v2:

- raw pasted content can be sent through the legacy bridge as `content`
- the bridge passes that raw blob into the v2 engine

This is the right architectural boundary because user input should be flexible, while canonical field constraints should still stay strict *inside* the engine.

## What Is Currently Strong

- stage separation is clear
- stage logs and debug metadata are good enough to tune systematically
- strict resolution is materially better than first-hit enrichment
- authority-applied field repair is now real
- provider stalls no longer have to become stage-level enrich failures
- dedup is more conservative in the presence of conflicting DOI evidence
- dedup now strengthens duplicate-family members instead of only tagging them
- local-ready logic for reports / books / websites is much more realistic than before
- local-ready logic now also handles clean provider-error cases more gracefully

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
