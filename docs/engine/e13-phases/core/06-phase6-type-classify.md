# Phase 6: Type Classification

One-line purpose: assign each carrier's final `referenceType` — accept the P5.8 structural route when it clears the confidence bar, otherwise resolve deterministically and (under `routed` policy) consult ML only on conflict/low-confidence.

## Pipeline position

P6 runs after P5.8 StructuralFamilyRouter and before P6.5 LLMFallback / P6.8 SharedRepair. It is the stage that commits `carrier.type`, which downstream normalization, health, authority, and rendering all key off. In the DOI fast path it is the second and last core stage (`runDoiCorePipeline`).

## Source

- `server/src/engine/phases/phase6TypeClassify.ts`
- `server/src/engine/utils/type-classification.ts` (`classifyTypeHeuristically`, `fallbackTypeConfidence`)

## Inputs (read)

- `carrier.structuralRouting` — the P5.8 route (`type`, `confidence`, `source`, `reasonCodes`).
- `carrier.raw` — for the deterministic heuristic and the ML call (`classifyType([carrier.raw])`).
- `carrier.style.family` — used by `shouldAttemptMlTypeResolution` to decide when a deterministic answer is suspect.
- `ctx.executionPolicy.typeClassificationMl` (`off` vs `routed`) and the phase budget.

## Outputs (written)

- `carrier.type`: `{ type, confidence, isUnknown }`. `isUnknown` is `true` when confidence < 0.6 or the type is `unknown`.
- Per-carrier + phase stage records; an `accepted structural routing` message when the route was promoted, a `TYPE_ML_UNAVAILABLE` warning when ML was attempted but fell back.

## Main behavior

For each carrier:

1. **Accept the structural route** if `shouldPromoteStructuralRoute(route)` passes. The route's own confidence becomes `carrier.type.confidence` and the stage short-circuits. Promotion gates:
   - `approved_truth` → always.
   - `authority_pack` → ≥0.92 for conference-paper/book-chapter/report, ≥0.95 otherwise.
   - `heuristic` → per-type floors: article-journal ≥0.95, conference-paper ≥0.93, book-chapter ≥0.93, report ≥0.90, preprint ≥0.95, thesis ≥0.97, patent ≥0.98 (book/webpage/dataset/unknown heuristic routes are **not** auto-promoted and fall through to deterministic resolution).
2. **Deterministic resolution** otherwise: `classifyTypeHeuristically(carrier)` + `fallbackTypeConfidence`. If ML is disallowed or `shouldAttemptMlTypeResolution` says it's unnecessary, this answer is committed as-is.
3. **ML resolution (routed only)**: attempted when deterministic is `unknown`, low-confidence (<0.74), conflicts with a non-unknown route, or hits a family/type mismatch heuristic (e.g. `web_accessed` family but a non-web type; `numeric` family classified `webpage` without a DOI/RFC/patent signal; `author_date` family classified `patent`). The ML prediction commits if it returns; any error/empty/budget-timeout falls back to the deterministic type and logs `TYPE_ML_UNAVAILABLE`.

## Parse-profile gating

- `core_parse_fast` → `typeClassificationMl: 'off'`: **no ML**. Every carrier is resolved by accepting a qualifying structural route or by the deterministic heuristic. This is the production fast-lane behavior, so type classification is effectively "structural route + heuristic" with no model call.
- `core_parse_full` / `current_runtime` → `typeClassificationMl: 'routed'`: ML is consulted only for the conflict/low-confidence subset above; high-confidence routes and confident heuristics never reach the model.
- The DOI fast path runs P5.8 → P6 directly; `approved_truth`/`authority_pack` routes seeded there are accepted without ML regardless of profile.

## Notable specifics

- **`TYPE_UNKNOWN` threshold**: `isUnknown` is the 0.6 confidence floor (or an explicit `unknown` type). A promoted structural route always yields `isUnknown: false` because routes only promote above their (higher) per-type floor.
- The router and classifier share `classifyTypeHeuristically` / `fallbackTypeConfidence`, so when no route is promoted the deterministic answer here matches the router's own fallback path — the split exists so the router can *recommend* while P6 *decides* and can still escalate to ML.
- ML conflict detection is family-aware (`carrier.style.family`), which is why P3's family decision indirectly gates whether a type is re-checked by the model.
