# Phase 3: Style Detection

One-line purpose: deterministically classify each block's citation **style family** and **specific style** (with confidence, runner-up margins, and a certainty tier) so downstream type/render logic and `auto` output-style resolution have a stable signal.

## Pipeline position

P3 runs inside the core lane, immediately after P2 Split and before P4 Extract. It is the stage that turns a `RawBlock[]` into the first `ReferenceCarrier[]`: `buildReferenceCarrier(block, style, ctx.detectionMeta, ctx.outputStyle)` is called here, so every later phase reads the style decision off `carrier.style`.

## Source

- `server/src/engine/phases/phase3StyleDetect.ts` (the stage)
- `server/src/engine/styleDetection.ts` (the scorer: `detectCitationStyles`, `normalizeStyleInput`, certainty tiers, batch smoothing)

## Inputs (read)

- `block.text` for each split block (the only per-block input; signals are derived inside the scorer, not carried in from P1/P2).
- `ctx.executionPolicy.styleDetectionMl` — `off` vs `hint_only`.
- `ctx.detectionMeta`, `ctx.outputStyle` — passed straight into the carrier constructor.
- `ctx.abortSignal` and the phase latency budget.

## Outputs (written)

A new carrier per block, with `carrier.style` populated as a `StyleDetectionResult`:

- `primary.style` + `primary.confidence`, optional `secondary`.
- `family` (`author_date` | `numeric` | `notes_bibliography` | `web_accessed` | `unknown`).
- `familyConfidence`, `styleConfidence`, `familyMarginToRunnerUp`, `styleMarginToRunnerUp`.
- `certaintyTier` (`high` | `medium` | `low`).
- `familyCandidates`, `styleCandidates`, `signals`, `conflictDampened`, `isUnknown`.
- `isMultiStyle` — set **batch-wide**: true if any block is multi-style or family drift across the batch exceeds 20% of blocks (`familyDrift > 0.2`).

Plus a stage record on `ctx.stageLog` (and per-carrier records when `debugMode !== 'off'`).

## Main behavior

1. **Input normalization** (`normalizeStyleInput`): NFKC, smart-quote/apostrophe folding, `&amp;`→`&`, superscript-digit folding, whitespace collapse — then **diacritic folding** (`foldStyleDiacritics`, NFKD + strip combining marks). This is style-detection-only: it keeps ASCII structural keywords ("Available", "Proceedings", "Press") matchable under copy-paste/OCR accent corruption. Extraction (P4) uses its own normalization, so extracted author/title accents are **not** affected.
2. **Family-first scoring**: signals are scored into a ranked family list; a family commits only above confidence/margin/min-signal-group thresholds, otherwise it degrades to `unknown` (with structural-family-gate and structured-exact-override escape hatches). Within the committed family, an exact style commits under its own thresholds, with numerous pairwise/structured commit profiles (APA, Harvard, Vancouver, IEEE, MLA, Chicago).
3. **Certainty tier** is derived from family confidence + style margin.
4. **Batch smoothing**: for batches ≥ 5 (and not multi-style), a dominant family/style nudges borderline same-family neighbors toward the majority; high-certainty decisions are never overridden.

## Parse-profile gating

The ML hint is gated by execution policy, not hard-disabled:

- `core_parse_fast` → `styleDetectionMl: 'off'`: **no ML call**; deterministic scoring only. The stage logs "ML hints were disabled by the execution policy."
- `core_parse_full` / `current_runtime` → `styleDetectionMl: 'hint_only'`: ML is consulted, but only as a **hint** into the deterministic scorer — it never replaces the deterministic decision.
- Note: under the `site_default` runtime profile the fast lane runs in worker threads with `core_parse_fast`, so the production single-/multi-ref hot path effectively runs deterministic-only style detection.

Two further short-circuits avoid the ML round-trip even when `hint_only` is set:

- **Confident single citation**: a 1-block batch whose deterministic result is high-certainty (not unknown, `familyConfidence ≥ 0.88`, `styleConfidence ≥ 0.72`) skips the ML hint entirely.
- **Budget exceeded / no client / error**: falls back to deterministic scoring and logs a `STYLE_ML_UNAVAILABLE` warning.

## Notable specifics

- The ML prediction is sanitized by `toMlStyleHint`: only a `supported_exact` decision with a concrete `exactStyle` is promoted to a usable hint; any other ML decision is dropped to `null` (deterministic-only).
- `deterministicStyleResults` are precomputed once when ML is `off` or the batch is a single block, then reused so the scorer isn't run twice.
- Output-style resolution for `auto` requests happens later (in the orchestrator's `resolveOutputStyle` / `representativeStyleForFamily`), driven by this phase's `primary.style` and `family`.
- Style uncertainty surfaced here can later become an `input_style_uncertain` signal via the style-resolution layer.
