# Phase 10: Health (+ Scoring)

## Purpose

Validate each reference against its style/type field schema, decide the user-facing status tier (`ready | needs_review | needs_action`), surface health warnings (including confident-but-wrong present values), and compute the structural/field-evidence subscores that feed the displayed quality score.

## Source

- `server/src/engine/phases/phase10Health.ts` — health validation **and** scoring
- `server/src/engine/phases/phase10Score.ts` — thin re-export: `Phase10Score`/`phase10Score` are aliases of `Phase10Health`/`phase10Health` (one stage covers both concerns)
- Supporting: `mandatory-fields.ts`, `healthRules.ts`, `healthWarnings.ts`, `confidenceCalibration.ts`, `scoringHelpers.ts`

## Pipeline Position

`P9 Dedup → P10 Health (+Score) → P11 Authority`. Tenth module of the 17-module pipeline. Runs per carrier; this is where partial success becomes a concrete user contract (the public status tier) and where the score breakdown is assembled.

## Inputs

- Post-dedup `ReferenceCarrier[]`, each with resolved `fields`, `type`, `style`/`styleResolution`, `splitMeta`, `detection`, `healthEvidence` (BIO span validity, prior warnings), `doiVerification`, `authority.scoreAdjustment`, `authorListIncomplete`, plus `ctx.outputStyle`.

## Outputs

- `carrier.publicStatus` / `carrier.health.publicStatus` (= `baseStatus`): `ready | needs_review | needs_action`, with `reasons[]`, the mandatory `breakdown` (missing/invalid/lowConfidence/present), `warnings[]`, and `demotedBy: 'none'`.
- `carrier.scoring.breakdown` populated: `fieldEvidenceScore`, `structuralIntegrityScore`, `fieldEvidence` (completeness, avg mandatory confidence), `structuralSubscores`, `penalties`, `authorityAdjustment`, plus detection diagnostics. `rawScore`/`displayScore` are staged to `0` here and finalized downstream.
- Per-carrier and stage `StageRunRecord`s (status `success` when `ready`, else `warning` with `SCORE_HEURISTIC_USED`).

## Main Behavior

For each carrier:

1. **Resolve schema.** Pick the effective output style (request override → carrier effective style → resolved fallback) and a validation reference type (`unknown` if the type is unknown or below `TYPE_UNKNOWN_CONFIDENCE_THRESHOLD = 0.6`), then `getFieldSchema` + `evaluateFieldSchema`.
2. **Validate mandatory fields & require-one-of groups.** Each mandatory field is checked for presence (`hasMandatoryPresence`), validity (`validateMandatoryField`), and confidence against a calibrated threshold (`getEffectiveMandatoryThreshold`), sorting it into `missingMandatory` / `invalidMandatory` / `lowConfidenceMandatory` / `presentMandatory`.
3. **Collect warnings.** `buildCarrierWarnings` folds in split-quality, style/type-uncertainty, detection-confidence, PDF-cleanup, and DOI-verification (`doi_conflicted` / `doi_unverified`) signals; preferred-field gaps and the confident-wrong detector are appended.
4. **Decide status** (`decidePublicStatus`) and **score** (field-evidence, structural subscores, penalties), then write health, status, and the scoring breakdown back onto the carrier.

### BIO / ML span handling

- A BIO-backed mandatory field counts as present only when its span is valid, grounded in source text, and above threshold; an ML field with a value but no valid span is treated as missing and emits `missing_required_ml_span`.
- `overlapping_spans`, `unclosed_bio_sequence`, `missing_required_ml_span`, and `invalid_author_span` are treated as field-content health warnings (they pull down `noArtifactTokensScore`).

### Confident-wrong detection (recent)

`detectImplausiblePresentFields` closes the engine's "confident-but-wrong" blind spot — fields that *are* present (so they'd otherwise read `ready`) but are structurally implausible. It inspects only untrusted heuristic values and flags only clear-cut errors, to avoid false-positiving on correct output:

- **`suspect_author_value`** (`review` severity): an author entry carrying a year / page-range / DOI / URL / `vol.` token (`AUTHOR_LEAK_PATTERN`) or implausibly long (> 50 chars) — i.e. an adjacent field was mis-segmented into the author span.
- **`suspect_locator_value`** (`review` severity): a page range whose start exceeds its end.
- **`author_list_incomplete`** (`info` severity): emitted when `carrier.authorListIncomplete` is set (an "et al." truncation stripped trailing authors at the source).

## Gating (status tiers)

`decidePublicStatus`:

- **`needs_action`** — any missing or invalid mandatory field, or any `action`-severity warning.
- **`needs_review`** — any low-confidence mandatory field, or any `review`-severity warning (this is where `suspect_author_value` / `suspect_locator_value` land).
- **`ready`** — otherwise. Info-severity warnings (e.g. `author_list_incomplete`) do **not** demote status and are excluded from `reasons`.

## Scoring Specifics

- **Field-evidence score** = mean of *completeness* (valid mandatory units + half-weighted valid preferred units, over a 1.0/0.5-weighted denominator) and *avg mandatory confidence*.
- **Structural integrity score** = average of seven subscores: ref-type confidence, no-duplicate-fields, no-artifact-tokens, no-corrupted-container, field-boundary integrity, no-duplicate-authors, and locator consistency. Each is a 0/0.5/1 heuristic (e.g. a year/page/volume token leaking into a container or title field, an author family containing a digit, or a reversed page range drives the relevant subscore to 0).
- **Penalties** (`computePhase10Penalties`): error state (20), uncertain split (10), short split (5), unknown type (6), unknown style (4) — recorded in the breakdown for the downstream final-score computation.
- The `authorityAdjustment` from Phase 11 is threaded into the breakdown; `rawScore`/`displayScore` are intentionally left at `0` for a later stage to finalize.

## Notable Specifics

- Health output is emitted as operational telemetry by the orchestrator in addition to shaping the per-reference contract.
- The stage's contract version is **2**.
- `hasMandatoryPresence` treats intrinsic-identifier fields (url/doi/pmid/arxiv/isbn/issn/handle/patent/accessedDate) as present-by-value, accepts validated BIO spans and trusted origins, and accepts heuristic values only from the extraction or shared-repair stages — preventing low-trust guesses from satisfying mandatory requirements.
