# Engine Phase Index

Last verified on 2026-06-25 against `server/src/pipeline/orchestrator.ts`,
`server/src/pipeline/coreBatch.ts`, and `server/src/engine/phases/`.

## Pipeline Map

The live pipeline is **17 phases** (13 numbered phases plus three `.8`/`.5`
extension stages, with Phase 10 covering both scoring and health). The DOI-list
source type takes a fast path: it resolves fields from the local Approved-Truth
cache instead of running split/style/extract/author (P2–P5), then re-joins the
pipeline at P5.8 structural-routing → P6 type-classify and onward.

| Stage | Source File | Primary Responsibility |
| --- | --- | --- |
| Phase 1 | `phase1Ingest.ts` | Input profiling, format detection, DOI discovery, structural cleanup (gated), and envelope creation. |
| Phase 2 | `phase2Split.ts` | Block aggregation, split decisions, PDF-cleanup adoption gate, and no-drop count audit. |
| Phase 3 | `phase3StyleDetect.ts` | Style and style-family detection per candidate block (ML hints off in `core_parse_fast`). |
| Phase 4 | `phase4Extract.ts` | Field extraction into the carrier field model (heuristic monolith; ML routing off by default). |
| Phase 5 | `phase5AuthorDisambig.ts` | Author parsing, disambiguation, and identifier-author group reconciliation. |
| Phase 5.8 | `phase5_8StructuralFamilyRouter.ts` | Structural routing / type-family biasing before final type classification. |
| Phase 6 | `phase6TypeClassify.ts` | Final reference-type classification. |
| Phase 6.8 | `phase6_8SharedRepair.ts` | Shared cross-field repair (runs before normalization). |
| Phase 6.5 | `phase6_5LLMFallback.ts` | Optional LLM repair for unresolved low-confidence cases (off by default). |
| Phase 7 | `phase7Normalize.ts` | Canonical cleanup and normalization of extracted fields. |
| Phase 8 | `phase8Enrich.ts` | Optional provider enrichment (Crossref/OpenAlex) and overwrite governance (off by default). |
| Phase 9 | `phase9Dedup.ts` | Duplicate clustering and grouping metadata. |
| Phase 10 | `phase10Health.ts` | Scoring **and** health/public-status classification (`phase10Score.ts` is a re-export alias). |
| Phase 11 | `phase11Authority.ts` | Authority / retraction / author-verification checks (only when enabled). |
| Phase 12 | `phase12Render.ts` | CSL rendering and export-ready citation text; computes the format-correctness score. |
| Phase 13 | `phase13FeedbackLoop.ts` | Approved-Truth overlay application and feedback capture / learning hooks. |

> All file paths are under `server/src/engine/phases/`.

## Execution order (the part that surprises people)

The numbered order is **not** the runtime order. The orchestrator runs:

1. **P1 ingest → P2 split** (or the DOI fast path for `doi_list`).
2. **Core batch** (`coreBatch.ts`, per chunk, concurrent): P3 → P4 → P5 → P5.8 → P6.
   In the `core_parse_fast` lane, **P6.8 shared-repair and P7 normalize run inline
   here** instead of as later whole-array passes (`runInlineFastLanePostProcessing`).
3. **P6.8 shared-repair → P6.5 LLM-fallback → P7 normalize** — note **shared-repair
   precedes LLM-fallback precedes normalize** (when not already inlined in the fast lane).
4. **P8 enrich** (only when `enrich` is on) → **P9 dedup → P10 health → P11 authority**
   (only when `authorityValidation` is on).
5. An OCR field-correction pass (`ingestion/ocrCorrect.ts`) runs **between P11 and P12**,
   gated to PDF/OCR cleanup mode so clean single refs skip it.
6. **P12 render → P13 feedback/overlay**.

Phases that are disabled for a given request emit a `skipped` stage record rather
than running — this is how `enrich`, `llmFallback`, `authorityValidation`, and
`feedbackLoop` are governed.

## Helper Systems That Affect Outcomes

- `server/src/engine/reliability.ts` — sticky invariants, field-move ledgers, mutation observation.
- `server/src/engine/fieldConfidence.ts` — field uncertainty synchronization.
- `server/src/engine/healthWarnings.ts` — health-warning construction and severity map.
- `server/src/pipeline/executionPolicy.ts` — the parse-profile resolver (source of truth for provider access, LLM fallback, debug, render/dedup/health modes).
- `server/src/pipeline/fastLane.ts` / `coreBatch.ts` — the batched fast-lane execution and inline post-processing.
- `server/src/pipeline/performance.ts` — stage timing and budget summaries.

## Reading Order

1. Phase 1–4 for ingestion and extraction.
2. Phase 5–7 (+ extensions 5.8 / 6.8 / 6.5) for structural correction and canonicalization.
3. Phase 8–13 for enrichment, dedup, scoring/health, authority, rendering, and feedback.
