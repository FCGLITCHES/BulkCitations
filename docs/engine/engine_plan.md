# Engine Plan

Last reviewed: 2026-06-25 (roadmap — intent is forward-looking; current-state claims verified against code).

## Contents

- [Implemented Baseline](#implemented-baseline)
- [File Plan](#file-plan)
- [Future Planned Work](#future-planned-work)

## Implemented Baseline

- Engine docs live under `docs/engine`.
- E13 phase docs are split into `e13-phases/core` and `e13-phases/extensions`.
- The phase index and overview were preserved and moved from legacy paths; the index now reflects the
  real **17-phase** set and runtime order (not just the numbered list).
- Several subsystem reference docs have since landed and are current: `system-assessment.md` (the holistic
  read), `field-ownership-map.md`, `phase4-refactor-seam.md`, `noise-cleanup-enrichment-handoff.md`, and
  `public-launch-quality-system.md`. The README index points at all of them.
- The Phase-4 ownership map is now **executable** (`phase4/extractionContract.ts`), with the DOI
  `DeterministicResolver` slice wired live (parity-locked); the rest of that contract is types-only.

## File Plan

| File | Implemented Today | Future Planned Work |
| --- | --- | --- |
| `README.md` | Engine scope, characteristics, subsystem summary, and a full index of the engine docs are documented. | Keep the index in sync as docs are added/removed. |
| `system-assessment.md` | Current holistic assessment of engine + ML + enrichment + infra, with a per-session progress log. | Keep the progress log current each work session. |
| `field-ownership-map.md` | Per-field owner (deterministic / BIO / enrichment), precedence, tiered execution; reflected as code in `extractionContract.ts`. | Set per-field BIO abstain floors + the Tier-1→Tier-2 residual trigger once real BIO data lands. |
| `phase4-refactor-seam.md` | The typed seam + migration sequence; DOI slice marked live. | Mark each further slice (pmid/isbn/arxiv/year, FieldMerger, ResidualPolicy) done as it lands. |
| `noise-cleanup-enrichment-handoff.md` | OCR/cleanup → enrichment handoff; recoverDoi-lookup-only + `FEATURE_LIVE_ENRICH` status captured. | Add an output-cleanliness / BIO-span-alignment metric to the eval harness. |
| `public-launch-quality-system.md` | Scoring (9 guaranteed styles), confident-wrong health flags, publish gate. | Expand reason-code catalog as new gates are added. |
| `engine-overview.md` | Deep engine behavior reference was preserved in full. | Split into smaller topical docs (routing, scoring, render, recovery). |
| `phase-index.md` | All 17 phases + the real runtime order are mapped to source files. | Add per-phase latency budget and fallback policy columns. |
| `e13-phases/README.md` | Core vs extension split is documented. | Add "when to update this doc" triggers for phase changes. |
| `e13-phases/core/01-phase1-ingest.md` | Ingest phase behavior and source mapping documented. | Add malformed input and adversarial examples with expected outcomes. |
| `e13-phases/core/02-phase2-split.md` | Split strategy and boundaries documented. | Add numbered/multiline/PDF-copy regression pointers. |
| `e13-phases/core/03-phase3-style-detect.md` | Style detection stage documented. | Add calibrated policy details and margin/abstain interpretation notes. |
| `e13-phases/core/04-phase4-extract.md` | Extraction stage behavior documented. | Add field ownership table (`coreTruth` vs `overlayTruth` semantics). |
| `e13-phases/core/05-phase5-author-disambiguation.md` | Author disambiguation stage documented. | Add contamination failure patterns and remediation examples. |
| `e13-phases/core/06-phase6-type-classify.md` | Type classification stage documented. | Add conflict resolution examples for family/type disagreements. |
| `e13-phases/core/07-phase7-normalize.md` | Normalization stage behavior documented. | Add invariance and canonicalization test references. |
| `e13-phases/core/08-phase8-enrich.md` | Enrichment behavior and controls documented. | Add explicit provider conflict ladder and locator conflict examples. |
| `e13-phases/core/09-phase9-dedup.md` | Dedup strategy and grouping behavior documented. | Add anti-clumping regression matrix and safe-fail conditions. |
| `e13-phases/core/10-phase10-health.md` | Health/decision stage documented. | Add confidence decomposition examples and interpretation guide. |
| `e13-phases/core/11-phase11-authority.md` | Authority phase documentation preserved. | Keep this stage doc-only unless feature is reintroduced by product decision. |
| `e13-phases/core/12-phase12-render.md` | Render stage behavior documented. | Add required/preferred field rendering matrix by style family. |
| `e13-phases/core/13-phase13-feedback-loop.md` | Feedback loop documentation exists. | Add explicit training ingestion contract and audit requirements. |
| `e13-phases/extensions/05-8-phase5-8-structural-family-router.md` | Structural family router helper documented. | Add trigger thresholds and bypass policy. |
| `e13-phases/extensions/06-5-phase6-5-llm-fallback.md` | Optional LLM fallback helper documented. | Keep default path local-only; document gated override policy only. |
| `e13-phases/extensions/06-8-phase6-8-shared-repair.md` | Shared repair helper documented. | Add deterministic safety constraints and no-silent-overwrite rules. |

## Future Planned Work

- Add a "phase change checklist" section required for every engine behavior update.
- Link each phase doc to specific regression suites and benchmark slices.
- Add explicit rollback/kill-switch notes for high-risk stages (`03`, `04`, `08`, `12`).
