# Phase 12: Render

## Purpose

Turn each carrier's structured fields into the final formatted citation string for the resolved style, then score the rendered output (content correctness, cosmetic format, structural integrity) and flag any eligible field that was dropped during rendering.

## Pipeline Position

Module 15 of the 17-module pipeline (P12), running after **P11 Authority** and before **P13 FeedbackLoop**. Consumes and returns `ReferenceCarrier[]`.

## Source

- `server/src/engine/phases/phase12Render.ts`
- `server/src/engine/scoreConfig.ts` (`GUARANTEED_SCORING_STYLES`, weights)
- `server/src/engine/scoringHelpers.ts` (`resolveFormatScoringPath`, `finalizeRawScore`, `finalizeDisplayScore`)

## Inputs

- Authority-checked `ReferenceCarrier[]`, each with normalized/enriched `fields`, resolved `type`, `styleResolution`, `doiVerification`, and `scoring.breakdown`.
- `ctx.outputStyle` — an explicit requested style, or `auto` / `unknown` to fall back to the carrier's resolved style.

## Outputs

Per carrier:
- `carrier.rendered = { text, warnings, assertionSummary, audit }` — `audit` lists `available` / `rendered` / `lost` / `suppressed` fields.
- `carrier.scoring.rawScore` (re-finalized here) and `carrier.scoring.displayScore = finalizeDisplayScore(rawScore, authority.scoreAdjustment)`.
- `carrier.scoring.breakdown` enriched with `contentCorrectnessScore`, `cosmeticFormatScore`, `formatCorrectnessScore`, `formatScoringPath`, segment/cosmetic subscores, and render penalties.
- `carrier.outputLatencyMs`; health demotions for render warnings (`health.demotedBy = 'render'`).

## Style Resolution

The active style is `ctx.outputStyle` when explicit; otherwise the carrier's effective resolved style (`styleResolution.effectiveStyle`), falling back to `resolveSchemaStyle(...)`.

## Renderers — all 9 are first-class

`renderCitation` dispatches by style to a dedicated renderer:

| Style | Renderer |
|-------|----------|
| `apa7` | `renderApa` |
| `mla9` | `renderMla` |
| `chicago-author-date` | `renderChicagoAuthorDate` |
| `vancouver` | `renderVancouver` |
| `ieee` | `renderIeee` |
| `harvard-ctr` | `renderHarvardCtr` |
| `ama` | `renderAma` |
| `acs` | `renderAcs` |
| `chicago-notes-bib` | `renderChicagoNotesBib` |

**AMA, ACS, and Chicago-notes-bib are real, independent renderers — not APA fallbacks.** Each has its own author formatter (e.g. ACS `Family, A. B.; …` semicolon-separated; AMA Vancouver-style `Family II`, 7+ → first 6 + *et al*; Chicago-notes `First Last … and …`, 4+ → *et al.*), title-casing rule, and per-type field layout. Only a genuinely unrecognized style hits the `default` branch, which tries `renderWithCsl` and falls back to `renderApa`.

Each renderer emits ordered `RenderSegment`s tagged with their owning `fieldKeys`. After dispatch, `appendMissingEligibleFields` re-inserts any eligible field a renderer didn't place (article-journal volume/issue/pages get a grouped locator fallback; locators/report numbers are positioned relative to the container), and `finalizeCitation` collapses whitespace and fixes punctuation.

### Field eligibility

`buildRenderEligibility` derives the type+style field schema (mandatory / preferred / require-one-of), then validates each present field (`validateRenderableField`). Notable suppression rules: DOIs that are `conflicted`, malformed `doi: https://doi.org/...` wrappers, and unverified DOIs that lose to a canonical webpage URL are dropped; DOI-shaped URLs are dropped unless backed by a matching unverified DOI. Invalid values become `suppressed` (with a reason) rather than rendered.

### Page ranges (where the en-dash is applied)

Pages are stored on the field as **canonical ASCII-hyphen** data. `formatPageRange` converts the hyphen to a typographic **en-dash (–) at render time, for every style** (the original per-style intent; Vancouver's abbreviated end-page remains a future refinement). This is the single place the en-dash is introduced — the stored field stays a hyphen.

## Scoring

For each carrier P12 computes:
- **`formatScoringPath`** via `resolveFormatScoringPath(style)` — `guaranteed` when the style is in `GUARANTEED_SCORING_STYLES`, else `fallback`. **All 9 styles above are in that set**, so the live styles always score on the guaranteed path; `FALLBACK_SCORING_STYLES` is empty.
- **Render plan** (`buildRenderPlan`) → semantic segment subscores → `contentCorrectnessScore`.
- **Cosmetic subscores** (title-case, spacing, duplicate-punctuation, punctuation) → `cosmeticFormatScore`.
- `formatCorrectnessScore = contentCorrectnessScore * (1 − 0.15 * (1 − cosmeticFormatScore))` — cosmetics can shave at most 15% off content correctness.
- **Assertions** (`runAssertions`): author-prefix match, year present, verified-DOI present, venue present for journals — surfaced as `assertionSummary { total, passed, failed }`.

`finalizeRawScore` recombines field / format / structural subscores with the style weights from `resolveScoreWeights` (guaranteed styles: 0.40 / 0.35 / 0.25), minus penalties; `applyHeuristicConfidenceFloor` then floors high-integrity, penalty-free, heuristic-path citations at **97**. `displayScore` is re-derived from the new rawScore and the authority adjustment.

### Render-omission flagging

`assessRenderedOutput` compares the audit's `available` vs `rendered` fields. Any `lost` field raises `render_output_structurally_incomplete` + per-field `render_eligible_field_omitted`; lost locator/DOI raise `locator_lost_during_render` / `doi_lost_during_render`; empty output, missing venue, and `fallback`-path output each raise their own warning. Structural incompleteness adds/removes the `render_structurally_incomplete` penalty. `applyRenderHealthDemotions` maps warning severities to `needs_action` / `needs_review`.

## Gating & Notable Specifics

- The `render_style_fallback` warning fires only on the `fallback` path; because all 9 production styles are guaranteed, it is effectively unreachable in normal operation (would require an unrecognized style routed through CSL/APA).
- P12 does **not** re-read the authority score from scratch — it reuses `carrier.authority.scoreAdjustment` when computing `displayScore`, so an authority penalty from P11 carries through.
- Italics are emitted as Markdown asterisks (`*...*`) by `italicize`; downstream consumers map these to the export format.
