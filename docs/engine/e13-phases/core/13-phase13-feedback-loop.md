# Phase 13: Feedback Loop

## Purpose

Overlay human/learned ground truth onto freshly processed citations: apply approved admin corrections, consensus user corrections, certified approved-truth overlays, and processed active-learning insights, then rescore each affected carrier.

## Pipeline Position

Final module (17 of 17) of the pipeline (P13), running after **P12 Render**. Consumes and returns `ReferenceCarrier[]`.

## Source

- `server/src/engine/phases/phase13FeedbackLoop.ts`

## Inputs

- Rendered `ReferenceCarrier[]` (fields, `id`, `raw`, `type`, `style`, scoring, rendered text).
- Persistence reads: `listCorrections()`, `listLearningQueue()`, `listApprovedTruth()` (and `getCitation` for consensus grouping), plus `getApprovedTruthRevision()` for cache invalidation.
- `ctx.outputStyle` — gates whether an overlay may override style and rendered text.

## Outputs

Per carrier (when something matches):
- Overwritten `fields[*]` via `applyCorrection` (sets `source`/`origin`/`confidence` and records `previousValue`), with `syncFieldUncertainty` re-run.
- Possibly overridden `type` + `structuralRouting`, `style.primary`, and `rendered.text` (overlay path).
- Rescored carrier via `rescoreCarrierAfterCorrection(carrier, ctx, changedFields)`.
- Stage records per carrier and one summary record (`Phase 13 applied N feedback correction(s)`).

## Behavior

Up front the phase loads approved corrections, builds consensus corrections, builds the certified approved-truth map, and indexes processed learning-queue insights by raw-text hash. Then, **per carrier, it applies the first matching source and stops** (the precedence order):

1. **Direct approved corrections** — keyed by `carrier.id`. Applies each approved field correction (`origin: admin`) and rescopes.
2. **Certified approved truth** — exact raw-text hash match (`hashInputForTruth` / `hashAdminTruthRawText`), else a normalized group-hash match. See overlay details below.
3. **Active-learning insight** — processed learning-queue row matched by `hashInputForTruth(carrier.raw)`; applies corrections with `origin: heuristic` (confidence 0.82, `uncertain: true`).
4. **Consensus corrections** — keyed by a normalized fingerprint of `carrier.raw`. Requires `>= 3` approved corrections agreeing on the same field+value, and (when user IDs are recorded) `>= 2` distinct users. Applied with `origin: user_consensus`.

If nothing matches, the carrier gets a "No feedback corrections applicable" record.

### Certified approved-truth overlays

`buildCertifiedApprovedTruthMap` loads up to 50,000 approved-truth rows and keys each by all of its hashes (input hash, truth hash, admin-raw-text hash, group hash). Rows are filtered to those that are **certified** and non-`quarantined`; `truthScope` is `overlay` (a certified `overlayTruth` patch) or `core` (certified core/expected fields). On collision, the higher-precedence row wins (`approvedTruthPrecedence`: overlay scope ranks above core; within scope, `gold > reviewed > draft`).

`applyCertifiedApprovedTruth` writes the scoped truth fields (`origin: admin`, confidence 1), parsing `authors`/`editors` strings via `parseAuthorSegment`. If the row carries an `expectedType`, it overwrites `type` and stamps `structuralRouting.source = 'approved_truth'`. If it carries an `expectedStyle` **and the request was auto/unknown**, it overrides the carrier style. `applyCertifiedApprovedTruthRenderedOutput` replaces `rendered.text` with the stored `corrected_output` / `formatted_string` — but only when the truth's `expectedStyle` is compatible with `ctx.outputStyle` (it won't paste an APA-formatted string onto an MLA request).

The exported `applyCertifiedApprovedTruthOverlays` runs the same overlay logic standalone (used outside the per-carrier loop, e.g. overlay-only passes), with a small group-lookup cache.

## Gating & Resilience

- **Isolated runtime bypass**: `loadCertifiedApprovedTruthMapFromStore` returns an **empty map** when `BULKREFERENCES_ISOLATED_RUNTIME === 'true'` (benchmark/profiling scripts). This avoids loading the full `approved_truth` table and holding the pg pool open after the run — the same isolation policy used elsewhere. Production never sets this flag, so live overlay behavior is unchanged. Direct corrections, consensus, and learning insights still run (they read their own persistence helpers).
- **Caching**: the approved-truth map is cached for 5 minutes and keyed by `getApprovedTruthRevision()`; concurrent loads share one in-flight promise. `prewarmCertifiedApprovedTruthCache` can warm it ahead of traffic.

## Notable Specifics

- This is an **overlay/rescore** stage, not an export packager. The old "packages outcomes for reporting / learning hooks" framing is inaccurate — P13 mutates carriers and rescOres them; BIO-supervision export of approved corrections is a separate downstream workflow, not work this phase performs.
- `applyCorrection` records `previousValue` / `previousSource` / `previousOrigin` on every field it overwrites, so the override is auditable and reversible in provenance.
- Corrections do not retrain the model. Approved review decisions can later be exported to processed BIO JSONL, trained into a staged bundle, validated, and promoted through gates — but that pipeline is external to P13.
