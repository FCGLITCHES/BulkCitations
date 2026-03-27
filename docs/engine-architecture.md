# Engine Architecture

## Regression Rule

If we encounter an issue in any batch-specific citation set, we do not validate the fix against only that one failing batch.

We rerun the companion real-world suites that exercise the same engine path so we can confirm the change does not weaken previously fixed behavior, reduce consistency, or silently trade one edge case for another.

This rule exists to keep the engine consistently accurate across batches, not just locally improved on one failing sample.

### Required Rerun Scope

| Change area | Minimum rerun scope |
| --- | --- |
| Shared pipeline logic (`normalize`, `validate`, `score`, `render`, shared repair helpers, shared extractor utilities) | Full cross-suite rerun of the real-world batch corpuses |
| `split` and raw-text chunking | All `raw_unstructured` / pasted-text real-world suites, numbered bibliography suites, multiline suites, and PDF-copy stress suites |
| Ingest adapters and source loaders | The affected ingest-path suites plus downstream real-world batches that depend on that path |
| Thresholds and tuning constants (`OPENER_THRESHOLD`, scorer weights, repair-confidence cutoffs, timeouts that change routing behavior) | Treat as shared logic and rerun the broader cross-suite gate |

If scope is ambiguous, rerun the broader suite.

### Permanent Regression Entry Standard

Every permanent regression entry should carry:

- the verbatim input citation or batch block
- the expected canonical or rendered outcome
- the motivating failure mode, such as `numbered_batch_clumping` or `website_author_false_positive`
- a stable provenance marker when available, such as the fixing commit or PR

Use real citations for positive and mixed-behavior regressions whenever possible. Synthetic fixtures remain appropriate for tightly controlled negative tests where the goal is to prove that a repair must not fire.

### Conflict Resolution

If a fix resolves one batch but a cross-suite rerun breaks another batch, the fix is not complete.

The resolution path is:

1. Keep the new regression that exposed the fresh conflict.
2. Iterate until both the original batch and the cross-suite batches pass.
3. If that is not possible, record the issue as a deliberate known trade-off with an explicit product decision.

A change is not mergeable while that conflict is still implicit.

## Table Of Contents

- [Scope](#scope)
- [Practical Rule Of Thumb](#practical-rule-of-thumb)
- [Engine Health Summary](#engine-health-summary)
- [Pipeline Overview](#pipeline-overview)
- [Problem Classification](#problem-classification)
- [Core Data Contracts](#core-data-contracts)
- [Stage Breakdown](#stage-breakdown)
- [Observability](#observability)
- [Configuration Reference](#configuration-reference)
- [Deferred Work](#deferred-work)

## Scope

This document describes the active `v2` citation engine. The legacy `/api/convert` website route mainly acts as a bridge into `v2` when `engineVersion = "v2"`, so the architecture that matters is the `v2` pipeline and its stage contracts.

## Practical Rule Of Thumb

1. If the raw text already looks like more than one citation, debug `split` first.
2. If boundaries are clean but fields are missing or mis-typed, debug `extract`.
3. If extracted fields are mostly correct but the bucket is too harsh, debug `validate` and then `score`.
4. If fields are correct but the final citation duplicates locators or punctuation, debug `render`.
5. If the issue appears only in one batch, rerun the companion real-world batches before accepting the fix.

## Engine Health Summary

| Stage | Strongest behavior today | Current gap | Status |
| --- | --- | --- | --- |
| `ingest` | Useful profile signals for routing and budgeting | Profile signals are descriptive, not yet ranked by downstream impact | Active |
| `split` | Strong for numbered bibliographies, blank-line boundaries, and PDF-copy artifacts with author/year openers | Still sensitive to pathological OCR and weak opener runs in mixed prose/reference blocks | Active |
| `detect` | Reliable style hinting plus uncertainty penalties from ingest | Family-ranking beyond one style label is still deferred | Active |
| `extract` | Best stage for actual field recovery; wide deterministic coverage plus bounded raw-PDF repair | Still the largest source of misses, especially adjacent-type ranking and sparse citations | Active |
| `enrich` | Strict authority repair and safe field merge logic | Coverage and rate limits still vary by provider and source type | Active |
| `normalize` | Conservative cleanup with bounded carry-through of repair metadata | Intentionally does not invent missing structure or broaden risky repairs | Active |
| `validate` | Good at surfacing corruption, split contamination, and missing required fields | Produces diagnostics only; it does not repair and some heuristics remain intentionally conservative | Active |
| `truth` | Fast approved-truth reuse with stable provenance | Only helps where approved truth already exists | Active |
| `dedup` | Strong duplicate-family hydration and revalidation | Same-title, same-year neighbors such as editions/translations still need careful tuning | Active |
| `group` | Stub only | Implemented but disabled by default | Disabled by default |
| `score` | Type-aware required fields and better local-ready behavior | Threshold changes are high risk and must always be cross-suite rerun | Active |
| `render` | Stable CSL rendering plus post-render cleanup | Output quality is still bounded by upstream canonical quality and CSL edge cases | Active |
| `respond` | Clear envelope with timings, fallbacks, and exports | Inherits all upstream quality; debug payloads can still get large in verbose mode | Active |

## Pipeline Overview

The active runtime order in `server/engine/v2/config.ts` is:

| # | Stage | Runtime state | Primary responsibility |
| --- | --- | --- | --- |
| 1 | `ingest` | Enabled | Classify input shape and emit profile signals |
| 2 | `split` | Enabled | Turn raw blocks into citation candidates |
| 3 | `detect` | Enabled | Infer style hints and confidence |
| 4 | `extract` | Enabled | Produce canonical fields from each citation candidate |
| 5 | `enrich` | Enabled | Verify and safely repair via authority data |
| 6 | `normalize` | Enabled | Canonical cleanup and bounded normalization |
| 7 | `validate` | Enabled | Produce structural, repair, and resolution diagnostics |
| 8 | `truth` | Enabled | Apply approved truth records |
| 9 | `dedup` | Enabled | Merge duplicate families and hydrate family members |
| 10 | `group` | Disabled by default | Placeholder group-level aggregation stage |
| 11 | `score` | Enabled | Compute field scores, bucket, and readiness |
| 12 | `render` | Enabled | Format the final citation string |
| 13 | `respond` | Enabled | Build the response envelope and exports |

The narrative order is intentional: parse and repair first, then validate the repaired result, then reuse truth, then deduplicate, then score, then render.

## Problem Classification

The engine has two important axes of failure: input path and corruption type.

| Input path | Typical failure class | Primary fix location | Important non-goal |
| --- | --- | --- | --- |
| `sourceType: "text"` / raw pasted reference blocks | PDF-copy artifacts such as split tokens, wrapped DOI/URL text, mid-reference line breaks, numbered-batch clumping | `split`, extract-prep in `rawPdfCopy.ts`, `normalize`, `validate` | `pdfplumber` does not fix already pasted text |
| `sourceType: "pdf_base64"` | Document extraction quality, text-layer quality, page layout recovery | ingest adapters, PDF extraction path, extractor routing | Do not solve this by overfitting pasted-text heuristics |
| Structured / semi-structured citation strings | Parser fidelity, source-type classification, renderer correctness | `detect`, `extract`, `normalize`, `render` | Do not add raw-PDF repair globally where it does not belong |

The key architectural rule is: pasted-text repair and PDF-file extraction are not the same problem. `pdfplumber` can improve `pdf_base64` text extraction later, but it does not solve artifacts that already exist inside pasted text.

## Core Data Contracts

The core canonical unit is `CanonicalCitation`. It carries:

- raw citation text
- canonical fields such as `authors`, `title`, `year`, `journal`, `pages`, `doi`, `url`
- `referenceType`
- field provenance (`source`, `confidence`, `stageId`)
- stage metadata for split, extraction, resolution, normalization, validation, duplicate handling, quality, and rendering

Two additional raw-text contracts matter for the pasted-text path:

- `V2SplitArtifact`
  - line-level evidence from `split`, including `contentLines`, `contaminationFlags`, `strippedRegions`, `rawOpenerScore`, and `openerConfidence`
- `V2PreparedWorkingChunk`
  - the bounded working text used by `extract`, including `fieldHints`, `appliedRepairs`, `repairMisses`, `residualArtifacts`, and `citationRepairConfidence`

These contracts are what let the engine explain why a citation became `ready`, `worth_reviewing`, or `action_needed` instead of returning only a final string.

## Stage Breakdown

### 1. `ingest`

**Purpose**

- classify the incoming payload shape
- estimate citation count
- emit routing signals such as `doi_heavy`, `ocr_noise_markers`, `book_tail_markers`, `conference_tail_markers`, and `mixed_style_markers`

**Produces**

- `rawItems`
- `inputProfile`

**Current strengths**

- profile signals already improve downstream routing, timeout scaling, and uncertainty handling

**Current gaps**

- ingest signals are still descriptive rather than ranked by downstream importance
- the stage is not yet the main source of source-type disambiguation

### 2. `split`

**Purpose**

- turn input blocks into citation candidates
- preserve line-level evidence for later repair and validation

**Primary contract**

- `split` produces `V2SplitArtifact` objects alongside empty canonical citations
- each content line carries `rawOpenerScore`, `openerConfidence`, `continuationSignals`, and a role of `content`, `artifact`, or `uri_tail`

**Opener scoring**

`split` uses `OPENER_THRESHOLD = 0.58` from `server/engine/v2/rawPdfCopy.ts`.

| Signal | Weight |
| --- | --- |
| valid numeric bibliography marker | `+0.40` |
| author-like opener | `+0.35` |
| year anchor present | `+0.25` |
| previous artifact boundary | `+0.10` |
| author opener plus continuation plus next-line year anchor | `+0.25` |
| numeric lead with Vancouver tail | `+0.25` |
| lowercase or connector lead | `-0.45` |
| no year and fewer than 4 tokens | `-0.20` |
| obvious continuation starters such as `In`, `pp.`, `doi:`, `http` | `-0.15` |

Acceptance rule:

- explicit numeric bibliography markers always start a new citation
- otherwise a boundary can still force a new citation if the line looks like an author/year opener
- otherwise `openerConfidence >= OPENER_THRESHOLD` is required

This is also the acceptance rule that protects continuous APA-style blocks from being collapsed into one citation.

**Current strengths**

- strong on numbered bibliographies
- strong on blank-line and artifact boundaries
- explicit support for URI tails and multiline PDF-copy recovery

**Current gaps**

- still sensitive to pathological OCR and reference blocks mixed with prose
- weak author openers without clear year anchors are still the hardest split cases
- LLM resplitting exists as a fallback but is not the mainline path

### 3. `detect`

**Purpose**

- infer style hints when `inputStyle` is `auto`
- lower effective confidence when ingest has already flagged uncertainty

**Current strengths**

- simple contract: keep the style label, reduce confidence when the blob already looks noisy

**Current gaps**

- style-family ranking beyond one label plus confidence is still deferred
- mixed-style batches are only softly penalized today; they are not deeply segmented by style family

### 4. `extract`

**Purpose**

- turn citation candidates into canonical fields
- choose deterministic, GROBID, hybrid, or LLM-backed extraction paths as needed

**Extract-prep working chunk**

Extract-prep is part of `extract`, not a separate pipeline stage. It prepares the bounded working text from `V2SplitArtifact` before parser extraction.

It does three things:

- rebuilds a stable `joinedText` from included lines
- derives bounded field hints
- applies bounded repairs inside those hint spans only

**Field hints**

The main bounded repair surfaces are:

- `doi_url`
- `locator`
- `container`
- `publisher_place`
- `journal_tail`

The current implementation also carries a conservative `title` hint. That exists for narrow cleanup and diagnostics, not as permission to introduce broad title-span repair. Title repair should remain the most conservative surface in this system.

**Wrapped-word cleanup**

Wrapped hyphen joining is intentionally guarded. It only joins when the continuation begins lowercase. This prevents false joins such as `Cross- Sectional` becoming `Cross-Sectional` when the uppercase continuation should remain separate.

**Allowlist schema**

The pasted-text allowlist in `rawPdfCopy.ts` uses this schema:

| Field | Meaning |
| --- | --- |
| `brokenSpan` | Verbatim broken text to match |
| `canonicalSpan` | Replacement text |
| `fieldType` | Bounded repair surface the rule is allowed to touch |
| `prefixAnchor` | Optional extra guard that must be present before replacing |
| `source` | Provenance for the rule |
| `createdAt` | When the rule was added |

Matching rules:

- `fieldType` must match the current hint
- if `prefixAnchor` exists, it must appear in the hint text
- replacement only happens inside the bounded hint span, never across the full citation text

**`citationRepairConfidence` lifecycle**

`citationRepairConfidence` is computed from bounded repair activity on the prepared working chunk. It becomes operational after extract-prep completes, then `normalize` copies it into `citation.normalization` alongside `appliedRepairs`, `repairMisses`, and `residualArtifacts`. Do not treat it as a stable canonical confidence before the working chunk exists.

**Current strengths**

- this is still the most important stage for actual quality improvement
- deterministic coverage is much better than before for books, websites, reports, conference tails, and raw-PDF artifacts
- extracted output now carries the prepared working chunk diagnostics forward

**Current gaps**

- still the largest single source of misses
- adjacent-type ranking is still hard for `book` vs `report`, `website` vs `report`, and `conference` vs `journal`
- sparse old references and weird institutional citations remain a recurring edge class

### 5. `enrich`

**Purpose**

- verify against authority data
- safely merge accepted authority fields into the canonical citation

**Current strengths**

- strict merge rules avoid blindly overwriting user or high-confidence local fields
- provider labels are normalized into engine-native reference types
- verified matches can now repair fields rather than merely annotate them

**Current gaps**

- provider coverage is uneven across source types
- rate limits and provider errors are still real operational constraints
- local-first site flows intentionally avoid always paying the enrich cost

### 6. `normalize`

**Purpose**

- perform conservative canonical cleanup after extraction and enrichment
- attach repair metadata to the normalized citation

**Current strengths**

- normalizes DOI, Unicode, locator formatting, institution/group-author fields, and edition values
- carries forward `appliedRepairs`, `repairMisses`, `residualArtifacts`, field repair confidence, and citation repair confidence

**Current gaps**

- intentionally conservative: it will not invent missing structure
- not the place for broad heuristic repair that should have happened in bounded extract-prep

### 7. `validate`

**Purpose**

- surface structural, repair, split, and resolution issues on the repaired citation

**Protected-token corruption**

Protected-token corruption means the engine lost or damaged important title or venue tokens that should survive parsing and normalization. Validation emits:

- `protected_title_token_corrupted`
- `protected_venue_token_corrupted`

These are driven by `getProtectedTitleCorruptionReasons(...)` and `getProtectedContainerCorruptionReasons(...)`, and they are treated as high-signal problems because they often indicate destructive parsing rather than harmless formatting drift.

**Current strengths**

- validates the repaired citation, not the pre-repair one
- catches split contamination, dropped locators, protected-token corruption, multi-reference bleed, and residual PDF-copy artifacts

**Current gaps**

- validation is diagnostic only; it does not repair
- some warnings are intentionally conservative and can feel noisy until the upstream extractor is improved

### 8. `truth`

**Purpose**

- apply approved truth records and preserve their provenance

**Current strengths**

- fast truth lookup
- stable truth identifiers and field-approval reuse

**Current gaps**

- only helps where approved truth exists
- not a substitute for improving generic extraction quality

### 9. `dedup`

**Purpose**

- identify duplicate families
- choose the strongest family member
- hydrate and revalidate the duplicates from the family canonical record

**Current strengths**

- duplicate-family hydration now keeps family members internally consistent
- duplicate penalties are explicit and field-based instead of opaque

**Current gaps**

- same-year, same-title neighbors such as editions, translations, and related works still require careful threshold discipline
- duplicate tuning can regress quickly if changed without cross-suite reruns

### 10. `group`

**Purpose**

- reserved for future group-level aggregation

**Runtime state**

- implemented but disabled by default in `server/engine/v2/config.ts`

**Current gaps**

- there is no active group behavior today
- if the stage is revived, it needs fresh contracts and regression coverage rather than documentation-only assumptions

### 11. `score`

**Purpose**

- compute per-field scores
- assign `ready`, `worth_reviewing`, or `action_needed`

**Reference-type requirement profiles**

`score` uses source-type-specific requirements from `qualityRules.ts` rather than one generic required-field set.

| Reference type | Required | Expected |
| --- | --- | --- |
| `journal` | `authors`, `title`, `year` | `venue`, `volume`, `issue`, `locator` |
| `book` | `authors`, `title`, `year`, `publisher` | `edition` |
| `conference` | `authors`, `title`, `year` | `venue`, `locator` |
| `chapter` | `authors`, `title`, `year`, `bookTitle` | `locator`, `publisher` |
| `website` | `title`, `url` | `authors`, `year` |
| `report` | `title`, `year` | `authors`, `institution` |
| `thesis` | `authors`, `title`, `year`, `institution` | none |

**Residual-artifact downgrade rules**

| Residual artifact state | Max bucket outcome |
| --- | --- |
| at least one `high` severity artifact | `action_needed` |
| artifacts in at least 2 distinct `medium` fields | `action_needed` |
| exactly 1 `medium` field, or only `low` artifacts | `worth_reviewing` |
| no residual artifacts | no artifact downgrade |

Constraint:

- artifact rules can worsen a bucket
- artifact rules never upgrade a bucket

**Current strengths**

- much better local-ready behavior for strong citations, even when providers miss or lack coverage
- verified citations can stay ready without a recovered venue when identity is already proven

**Current gaps**

- threshold and weight changes are high risk because they shift behavior across the entire engine
- scoring quality is still only as good as upstream extraction and validation fidelity

### 12. `render`

**Purpose**

- convert canonical citations to the requested style
- clean up renderer artifacts without rewriting the citation semantically

**Current strengths**

- reuses CSL infrastructure efficiently
- includes post-render cleanup for duplicated punctuation and protected initial punctuation
- strips duplicated locator tails when structured locators already exist

**Current gaps**

- render cannot rescue badly structured upstream fields
- some style-specific assertions still depend on CSL edge behavior

### 13. `respond`

**Purpose**

- build the final API response
- expose exports, stage timings, fallbacks, and slowest-stage telemetry

**Current strengths**

- response includes `processingPath.stageTimings` and `processingPath.slowestStages`
- exports and debug payloads are attached in one place

**Current gaps**

- this stage is packaging only; all real quality work happened earlier
- verbose debug mode can still create large payloads for heavy jobs

## Observability

Performance telemetry belongs here, not inside the middle of the stage narrative.

The engine records:

- `stageTimings` for every stage
- `slowestStages` sorted by duration
- `fallbacksUsed`
- `partialResult` and `partialReasons`
- per-citation stage debug when debug mode is enabled

The default debug posture is intentionally compact:

- `V2_DEBUG_PIPELINE=1` enables debug mode
- `V2_DEBUG_VERBOSE=1` expands per-stage payload detail
- structured stage logs remain optional

## Configuration Reference

| Variable | Default / interpretation | Effect |
| --- | --- | --- |
| `V2_DEBUG_PIPELINE` | off unless `1` | Enables pipeline debug payloads |
| `V2_DEBUG_VERBOSE` | off unless `1` | Expands verbose per-stage debug fields |
| `V2_DEBUG_STRUCTURED_LOGS` | off unless `1` | Enables structured debug logging |
| `ENABLE_GROBID_EXTRACTOR` | off unless truthy | Allows GROBID-backed extract paths |
| `GROBID_URL` | `http://localhost:8070` when read in adapters | GROBID service endpoint |
| `ENABLE_LLM_EXTRACTOR` | on unless explicitly falsy and an API key exists | Allows LLM-backed extract fallback |
| `OPENAI_API_KEY` | none | Required for LLM split/extract |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` | OpenAI-compatible base URL |
| `OPENAI_EXTRACT_MODEL` | adapter default | Model for LLM extraction |
| `OPENAI_SPLIT_MODEL` | falls back to extract model | Model for LLM split fallback |
| `OPENAI_EXTRACT_TIMEOUT_MS` | from `llmConfig.ts` | Per-call LLM extract timeout |
| `OPENAI_SPLIT_TIMEOUT_MS` | from `llmConfig.ts` | Per-call LLM split timeout |
| `V2_EXTRACT_CONCURRENCY` | dynamic by extractor path | Extract-stage concurrency |
| `V2_ENRICH_CONCURRENCY` | `3` in pipeline timeout planning, `8` inside enrich defaults | Enrich concurrency tuning |
| `V2_ENRICH_CITATION_TIMEOUT_MS` | stage default when unset | Per-citation enrich budget |
| `V2_ENRICH_TIMEOUT_MS` | optional override | Stage-level enrich timeout override |
| `V2_EXPORT_SIGNING_SECRET` | environment-specific | Export URL signing |

## Deferred Work

The following items are intentionally deferred and should stay treated as deferred until they have explicit contracts and tests:

- `pdfplumber` and better text-layer extraction for `pdf_base64` ingest
- style-family ranking beyond one style label plus confidence in `detect`
- deeper source-type ranking between adjacent categories such as `book`, `report`, `website`, and `conference`
- extractor field-loss ranking so we can measure which fields each extractor path drops most often
- meaningful activation of the `group` stage

Phase 1 should stay focused on stable split, extraction, validation, scoring, and render behavior rather than widening the scope with half-documented deferred work.
