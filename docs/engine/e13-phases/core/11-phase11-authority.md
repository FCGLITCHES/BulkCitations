# Phase 11: Authority

## Purpose

Validate each citation against external authority signals (retraction / expression-of-concern notices and provider-metadata conflicts), record `AuthorityFlag`s, adjust the display score, and demote public status / health when something looks wrong.

## Pipeline Position

Module 14 of the 17-module pipeline (P11), running after **P10 Health** and before **P12 Render**. Consumes and returns `ReferenceCarrier[]`.

## Source

- `server/src/engine/phases/phase11Authority.ts`

## Inputs

- Health-scored `ReferenceCarrier[]`, each with:
  - `scoring.rawScore` (already finalized by health) — P11 only sets `displayScore`.
  - `enrichment.crossrefHit` — gates the metadata/author-conflict checks.
  - `fields.*` with `previousValue` / `source` provenance recorded by P8 Enrich (used to detect enrichment-introduced conflicts).
  - `doiVerification`, `type`, `publicStatus`, `health`.

## Outputs

Per carrier:
- `carrier.authority = { checked, flags, scoreAdjustment, nextRecheckAt }` — `nextRecheckAt` is always **30 days** out.
- `carrier.scoring.displayScore` = `finalizeDisplayScore(rawScore, scoreAdjustment)`, plus `breakdown.authorityAdjustment`.
- `carrier.publicStatus` demotions (see below) and matching `health.warnings` / `health.reasons`, with `health.demotedBy = 'authority'`.
- Stage records appended to `carrier.stageLog` and one summary record to `ctx.stageLog`.

## Behavior

The default checker is `RealAuthorityChecker`. For each carrier it builds a flag set keyed by flag type (later flags of the same type overwrite earlier ones):

1. **Heuristic pass** (`HeuristicAuthorityChecker`) — substring scan of `raw + title` for `"retracted"` and `"expression of concern"`. Always runs; serves as the fallback if the network check fails.
2. **Retraction Watch lookup** — if a DOI is present, `retractionWatchService.check(doi)` can set `retracted` / `expression_of_concern` flags (with a `date`), upgrading the source from `heuristic_retraction_watch` to `retraction_watch`. Any thrown error is swallowed and the heuristic flags remain.
3. **Provider-metadata checks (only when `enrichment.crossrefHit`)**:
   - `detectAuthorConflict` — first-author family-name mismatch between the pre-enrichment value (`authors.previousValue[0]`) and the enriched value, when `authors.source === 'enrichment_crossref'`.
   - `detectMetadataMismatch` — flags a likely wrong-record match when enrichment changed metadata, in priority order:
     - **Year jump** > 1 year between `year.previousValue` and the enriched value (crossref or openalex).
     - **Type→book mismatch** — an `article-journal` / `conference-paper` that resolved to a book record (enrichment DOI matching `/book|/chapter`, an ISBN-shaped DOI, or an enrichment-added ISBN).
     - **Title divergence** — enriched title (crossref/openalex) whose token (Jaccard) similarity to the previous title is `< 0.5`. Titles `>= 0.5` similar are treated as trusted corrections and do **not** flag, because P8 only overwrites a title when an independent anchor (DOI/year/author) agreed.

`scoreAdjustment` is the sum of per-flag penalties:

| Flag | Penalty |
|------|---------|
| `retracted` | −45 |
| `expression_of_concern` | −25 |
| `author_conflict` | −10 |
| `metadata_mismatch` | −10 |

**Public-status transitions:**
- any `retracted` flag → `needs_action` (unconditional).
- any `expression_of_concern` / `author_conflict` / `metadata_mismatch` flag → `needs_review`, but only if the carrier was still `ready`.

Each flag also pushes a matching health warning (`authority_retraction_notice`, `authority_expression_of_concern`, `authority_author_conflict`, `authority_metadata_mismatch`) and reason, and sets `health.demotedBy = 'authority'`.

## Gating & Resilience

- Runs over all carriers with bounded concurrency (`min(PIPELINE_MAX_CONCURRENCY, carriers.length)`).
- **Phase latency budget**: `isStageBudgetExceeded` / `runWithRemainingStageBudget` cap the phase. When the budget is exhausted (before or mid-check), the carrier degrades to `checked: false`, `flags: []`, `scoreAdjustment: 0`, `displayScore = rawScore`, and logs a timeout warning (`AUTHORITY_RETRACTION_WATCH_TIMEOUT`). The phase never throws out of the pipeline — per-reference failures are isolated and logged (`AUTHORITY_RETRACTION_WATCH_ERROR`).
- The network path is the Retraction Watch service only; the provider-metadata checks read provenance already on the carrier, so they run offline. The legacy "authority validation can be skipped via pipeline options" note no longer reflects the code — the phase always runs; it is the **Retraction Watch provider** that is default-off / local-fallback, and the rest degrades under the latency budget.

## Notable Specifics

- P11 is the only phase that writes `authority.scoreAdjustment`; P12 re-derives `displayScore` from the (post-render) rawScore using this same adjustment, so the authority penalty survives rendering.
- Flags are deduplicated by type; the strongest source for a given type wins (Retraction Watch over heuristic).
- `metadata_mismatch` is deliberately conservative on titles (similarity gate) so that trusted enrichment corrections are not demoted — only wrong-record-looking changes raise a review flag.
