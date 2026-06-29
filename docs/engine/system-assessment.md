# BulkReferences — System Assessment (2026-06-24, updated 2026-06-25)

A holistic read of the engine, ML/BIO system, enrichment, data, API/infra, and frontend,
and how they work in tandem. Based on a parallel read of the whole tree, reconciled with
the founder's own context on *why* things are the way they are.

## Progress since this assessment (2026-06-25)

Five of the cross-cutting items moved this session — all verified, most committed:

- **`pages` glyph — FIXED.** The field now stores the canonical hyphen (matches gold); render
  applies the en-dash per style (`formatPageRange`). The 0.07-strict-F1 defect on every ref is
  gone, confirmed live (`461-468` field → `461–468` render). *(blocker #1 / §E)*
- **Enrichment — VERIFIED offline.** Built the fixture record/replay harness (`eval-enrichment.mts`
  + `provider-records.gold-v1.json` from the 1000-row gold). Proved **full-recover 72.8% → 89.3%
  (+16.5)**, **0 over-enrichment regressions, 0 external fetches**. Prod-enable (cache + 50-call
  budget) is now the *only* remaining step. *(blocker #2 — the highest-ROI item)*
- **Health confident-wrong — FIXED.** New `suspect_author_value` / `suspect_locator_value` review
  flags catch mis-segmented authors / reversed page ranges (76/1000) instead of passing them as
  `ready`. *(§E)*
- **OCR tolerance — landed.** `repairOcrArtifacts` reduced to safe ligatures-only; grammar-constrained
  DOI recovery (`ocrFold.ts`) wired into the enrichment lookup; extraction-layer de-hyphenation.
- **BIO build no longer 500s.** "Train the dataset" now skips zero-train-row holdout sets when
  auto-selecting and returns a clear `400` instead of a raw trainer 500 (dataset selection hardened).
- Infra-adjacent: the long-broken **grobid CI** (pnpm setup-order, red on main since April) is green;
  the **Vercel frontend** output-dir 404 is fixed + live with auth env vars.

### Waves 1–3 implemented (2026-06-25) — 8 workstreams, all regression-gated (50/50), builds clean

- **#2 Enrichment — ENABLED** behind `FEATURE_LIVE_ENRICH` (default off → prod byte-identical) + persistent provider cache + 50-call budget. Flip the flag to go live.
- **#3 Monolith — first DOI slice landed.** `DeterministicResolver.resolveDoi` wired (the seam went from 0 importers to live), inline DOI deleted, **parity-locked byte-identical** (0 diffs / 6000 evals). pmid/isbn/arxiv/year are follow-on slices.
- **#5 BullMQ + normalization — DONE.** Dead `server/src/queue/` deleted (false durability gone); 4×→1× input normalization (parity-proven latency win).
- **#6 `AdminTraining.tsx` — partial.** 3 dialogs extracted to `admin-training/`; **7,473 → 6,797 lines** (-676). The ~840-line editor dialog left in (too much state to lift safely yet).
- **Quality gaps:** **CSL renderers** (AMA/ACS/Chicago-notes-bib real + fallback gate cleared — no more silent APA), **ISBN** (Springer print-vs-electronic, F1 0.788→0.815), **author parser** (corporate-comma → org, Cyrillic, `et al.` → `author_list_incomplete` flag).

**Still open:** #4 train/val/test split (other chat — `real_train_v4` 332/16 landed); the remaining monolith slices (#3); the **authority pack** (data-blocked — 0/1,027 `approved_truth` rows certified for `authority_pack/core`).

## One-line verdict

A **Formula-1 chassis currently running a lawnmower engine.** The architecture, data
governance, and MLOps scaffolding are sophisticated and unusually disciplined — but every
"intelligence" layer (BIO ML, live enrichment, PDF/OCR cleanup) is intentionally gated off
or unfinished, so production quality today equals the output of one ~25,000-line heuristic
file. This is a *finish-the-wiring + shrink-one-file* situation, not a rebuild. The system
is **paused mid-build, honestly**, not broken.

## How it works in tandem (production, today)

1. React UI → `POST /v1/convert` → `optionalAuth` sets tier (anon default) → Zod validation
   → quota check (anon **10 refs/day**, free 50, pro 10k).
2. ≤500 refs run **synchronously inside the Fastify request** (`jobs/runtime.ts` uses
   `queueMicrotask`, *not* BullMQ — that's dead code). Real bottleneck = engine CPU in-process
   (~90 refs/s, normalization-bound).
3. Pipeline P1→P13: ingest → split (no-drop count audit) → style-detect *(ML off)* →
   **P4 extract (heuristic monolith; ML off; enrichment off)** → author → type → LLM-fallback
   *(off)* → normalize → **P8 enrich (forced off)** → dedup → health → authority *(local-only)*
   → render (per-style CSL) → feedback overlay.
4. Separately, the intended flywheel: report → learning queue → admin verifies fields in
   Approved Truth → render variants → certify → **BIO-tag tokens** → export NDJSON → train
   ml-service → promote ONNX. Built in the UI, **not closing** (trainer is a stub, model is a toy).

## The cross-cutting finding: everything smart is dark — on purpose

| Layer | Why it's off (reconciled with founder) | Status |
|---|---|---|
| **BIO ML** (Phase 4) | `ML_PHASE4_MODE=heuristic` default; `context.ts:37-44` force-disables ML under `site_default`. Model = 96-dim BiLSTM→ONNX trained on **298 rows, 0.0 val/test**. | Plumbing mature, model is a placeholder. Correctly not trusted. |
| **Enrichment** (Phase 8) | `convert.ts:409` forces `enrich=false`; `core_parse_full` sets `providers:'off'`. **Intentional**: live API costs money + rate limits, founder is the only tester, doesn't want to exhaust quota. Needs verifying, not fixing. | Machinery sound + conservative. Needs an **offline record/replay** path to verify cheaply. |
| **PDF/OCR cleanup** | `FEATURE_PDF_CLEANUP` + `lookedLikePdfCopy` detection + split-quality gate → off for single refs. | Reliability fix landed (`repairOcrArtifacts` made safe). Gate-tuning + validation pending. |

**Net: a production `/convert` = heuristic extraction + ~40 static DOI hints + ~67 ISSN hints +
deterministic render.** Every sophisticated layer — the ≥0.85 overwrite/DOI-verify machinery,
the circuit-breakered ML edge, the OCR-DOI recovery — is real but currently bypassed.

## Maturity scorecard

| Subsystem | Architecture | Live in prod? | Real maturity |
|---|---|---|---|
| Render / styles (P12) | Strong | ✅ | Production — 9 styles, **all real now** (AMA/ACS/Chicago-notes-bib implemented; no more silent APA fallback); `pages` en-dash per style |
| Field provenance + no-drop invariant | Excellent | ✅ | Production — the correctness backbone |
| **P4 extraction core** | Poor (monolith) | ✅ | **Ships but fragile** — ~25k lines; `pages`+`isbn` fixed; **DOI now via `DeterministicResolver` seam (1st migration slice)** — monolith shrink begun |
| Tiered refactor (`extractionContract.ts`) | Excellent | ❌ dead code | **0 importers** — aspirational (unchanged) |
| BIO ML | Mature plumbing | ⚠️ gated off | Toy model behind a real circuit breaker; **build hardened (no 500 on holdout)** but promotion still blocked by missing val/test split |
| Enrichment / authority | Strong, conservative | ⚙️ flagged (default off) | **Enabled behind `FEATURE_LIVE_ENRICH`** + cache + budget (flip to go live; +17.5 offline, 0 over-enrich, $0); authority pack still empty (data-blocked) |
| Health / output QA | Strong | ✅ | **No longer blind to confident-wrong** (suspect author/locator flags); still no isbn/author-parse fix |
| Data governance | Excellent | ✅ | Rigorous; but ~355 real BIO rows (372 in newest train set) |
| API / quotas / authz | Strong | ✅ | Boot-time authz matrix is a real strength |
| Queue / async | In-process | ✅ | **Dead BullMQ deleted**; in-process `queueMicrotask` is the (honest) path |
| Admin HITL tooling | Good (BIO review) / sprawling | ✅ | BIO-tag UI polished; BIO build hardened; `AdminTraining.tsx` **7,473→6,797** (3 dialogs extracted — decomposition underway) |

## Genuine strengths

- **Field-value provenance + `canOverwrite()` precedence** (admin > authority > enrichment-by-
  confidence > ml > regex): centralized, tested, auditable.
- **Count-audit / no-drop invariant**: a reference never silently vanishes.
- **Data governance**: sealed train/val/test splits, `canonicalWorkKey`/`nearDupClusterId`
  leakage control, two-pass certification, projection that *flags* unalignable spans not drops.
- **Intellectual honesty**: refuses bootstrap bundle in prod; docs say "do not make BIO the live
  primary parser"; the priority plans name their own gaps. The system doesn't lie to itself.

## The debt — and the founder's framing

1. **The monolith (`phase4Extract.ts`, ~25k lines)** → **FIX.** The clean tiered replacement is
   fully unwired. Direction (founder, agreed): the `DeterministicResolver` must **shrink** this
   file, not grow beside it — every field it owns gets *deleted* from phase4. Start with
   identifiers (deterministic, parity-testable). Net-negative lines per migration is the rule.
2. **Enrichment forced off** → **VERIFY, don't fix.** Off for cost/rate-limit/solo-testing
   reasons, which is sensible. Unblock with **record/replay against the 1000-row gold** (already
   Crossref-derived), then enable in prod with caching + the 50-call budget.
3. **Data location** → mostly a non-issue. v2 citation-bio = synthetic, fine to drop. **Keep
   `real-input-gold-v1.jsonl` (1000 real rows)** despite the v2 path. Real issue = *volume*
   (~355 real BIO rows is too few); fix is operational — tag the 1000 corpus to grow gold.
4. **Vestigial infra** → **IMPROVE/OPTIMIZE, don't rebuild.** In-process is fine at current
   scale. Concrete wins: delete dead BullMQ (false durability), fix double `phase1Ingest` per
   request, lower/async the 500-ref sync threshold.

## Strategic sequence (recommended)

1. **Verify enrichment offline (cheap, highest quality ROI)** — record/replay cache from the
   1000-row gold → prove the canonical-truth resolver → enable in prod safely.
2. **Shrink the monolith via the seam** — migrate identifiers into `DeterministicResolver`
   first; delete the equivalent phase4 code; parity-lock with the benchmark.
3. **Close the data flywheel** — replace `stub_train.py`, grow real BIO gold by tagging the
   1000 corpus, train one honestly-measured model.
4. **Optimize + de-lie the infra** — remove dead BullMQ, fix double-ingest, decompose
   `AdminTraining.tsx`, align docs/marketing with reality.

> The risk to manage is *inversion of effort*: the on-path (the monolith) is the least-loved
> code; the most-loved code (the tiered design, enrichment, ML) is off. Finish the wiring into
> the path users actually hit before polishing the dark rooms.

---

# Deep-dive: the real issues (per subsystem)

A second, surgical pass through each subsystem. The headline: **almost every "off" thing is
gated behind one or two specific, mostly-mechanical blockers — not deep architectural problems.**
This is a "finish the last 10%" system, not a "rebuild the 90%" system.

## A. The monolith — already half-solved upstream

- **The deterministic identifiers are already extracted cleanly** by `extractionFeatures.ts`
  (261 lines, one regex pass) + `identifierUtils.ts` (checksum normalizers). `phase4Extract.ts`
  only *consumes* them (lines 3633–3798). The `DeterministicResolver` is therefore mostly a
  **wrapper over an asset that already exists** — not new code.
- **First slices (parity-locked, each its own PR):** DOI (replace 3671-3675) → pmid/handle/url
  → arxiv/issn (+delete inference ~40 lines) → **isbn (delete the 203-line cluster 15103-15305)**
  → year. Net: **~540 lines deleted, ~150 glue added.** Net-negative, as required.
- **Defer** volume/issue/pages — born in the shared `parseStructuredReference` (582 lines) and
  tangled with title/journal recovery in `cleanupFinalArticleLocatorSpills` (383 lines).
- **Never touch** the 79 conference functions / ~5,669 lines (free-text/enrichment-owned —
  a separate project; do not let decomposition scope-creep into it).
- **Parity oracle:** `semanticHash.ts` `fieldHash`/`contractHash`; run
  `benchmark:series --requireFieldHashStable=true --requireContractHashStable=true` demanding
  `fieldHash == baseline`, plus `regression/runner.ts` fixtures green.
- **3 traps:** ISBN inference needs `typeHint` (widen the signature or leave inference behind);
  URL synthesis (`doi.org/...`) is cross-field (keep in phase4); abstain-on-checksum-fail changes
  `contractHash` (ship omit-compatible first).

## B. Enrichment — verification is 80% already scaffolded

- A **`NODE_ENV==='test'` fixture swap already exists** (`HeuristicCrossrefService` backed by
  `providerFixtures.ts`). **766/1000 gold rows carry a real DOI = the exact fixture key.**
- **Minimal offline-verify plan (zero production edits):** (1) generate
  `provider-records.gold-v1.json` from each gold row's `expected_fields` (~766 entries);
  (2) `FixtureCrossrefService`/`FixtureOpenAlexService` reading it; (3) inject via the existing
  `createPipelineDependencies({ enrichmentPhase })` seam, with `parseProfile:'pro_overlay_enrich'`
  + `enrich:true` (the **two** layers that force `enrich=false` are `convert.ts:409` — bypassed by
  calling the pipeline directly — and `executionPolicy.ts:114`, defeated by the profile).
- **Measure:** full-recover delta per mode (`ocr_like` should jump as recovered DOIs resolve),
  an over-enrichment precision guard, and a `fetch`-throws assertion to prove $0/offline.
- **Live cost reality:** Crossref is serialized at ≥300ms; **the per-job budget is 50 calls**, so
  a 1000-row live run physically can't enrich past 50/job — fixtures are the *only* way to verify
  all 1000 repeatably.
- **Generated authority pack** (missing on disk) is **orthogonal** — it feeds Phase 11/type-class,
  not Phase 8. Built from the DB via `build-authority-pack.ts`. Restore separately.

## C. ML flywheel — blocked by a missing data split, not the trainer or the data

- **The trainer is real** (`train_bio_bundle.py`, a working PyTorch→ONNX BiLSTM; fits to 0.994
  train acc). The "hang >700 rows" is the **O(tokens²) Python alignment loop re-run per epoch with
  no mini-batching** (`:140-201`, `:244-260`) blowing the 900s admin timeout — mechanical to fix.
- **The data is enough** (~372 rows) for a first model that beats the synthetic baseline.
- **The actual blocker:** `build_real_train.py:249` writes **every row as `split:"train"`** →
  0 val / 0 test → (a) the "0.0 metrics" are empty-eval-set artifacts, and (b) the promotion gate
  `evaluateBioPromotionGate` requires `rows_val>0 && rows_test>0` (`adminTruthRoutes.ts:4170`) so it
  **can't promote honestly**. The bundle validator (`bundle_validation.py`) is metric-blind and let
  a 0.0 model into `current/`.
- **The consensus auto-gold loop is dead AND deadlocked:** `triageRows` has zero production callers,
  and even wired it routes to `needs_review` (never `auto_gold`) when the model vote is unavailable —
  which it always is while ML is off. **No live model → no auto-gold → no data → no model.**
- **Highest-leverage fix:** add a stratified train/val/test split to `build_real_train.py` (a few
  lines), run the existing manual build→promote, flip Phase 4 to `shadow` then `primary`. That
  yields **one honestly-measured live model** — the actual goal. Then bootstrap the consensus loop
  with `autoGoldWithoutModel:true`.

## D. Infra — quadruple normalization + a dead queue

- **`phase1Ingest` runs 2× per request, each normalizing 2× internally → 4× `normalizeIngestionText`
  on identical input** (`convert.ts:208-215` preflight + `orchestrator.ts:134` + `phase1Ingest.ts:82`
  & `:222`). The NFKC pass at `normalize.ts:24` exists only to set one diagnostic boolean. Fix: thread
  the preflight envelope through + de-dup the internal call → 4→1. ~Half a day, pure latency win.
- **Sync threshold 500 = ~5.5s event-loop block.** A worker-thread offload *exists* but only fires
  for `core_parse_fast` (`orchestrator.ts:459`); the default `core_parse_full` runs on the main loop.
  Lower the threshold to ~100-150 and/or allow the worker path for full.
- **The entire `server/src/queue/` (BullMQ) is dead** except a no-op `closeQueues`. The live async
  path is in-process `queueMicrotask`. **Delete it** — the `attempts:3 / backoff / removeOnFail:7d`
  config reads as durability that doesn't exist (the real failure-mode risk).
- **`idempotencyKey` is parsed, persisted with a `.unique()` constraint, but never used to dedup** —
  a client retry re-runs the pipeline and can hit a unique-violation. Honor it or drop it.
- **`structuredClone` ~15×/citation** in the response builder (`orchestrator.ts:1222-1280`) → ~7,500
  deep clones for a 500-ref job; most are defensive copies of soon-discarded carriers. Trim for the
  non-debug path.

## E. Live output quality — two broken fields ship today

Production = deterministic regex + structured parser (ML shadow-only, enrichment off). Real defects:

- ~~**`pages` strict exact-match F1 = 0.07**~~ → ✅ **FIXED (2026-06-25).** The field now stores the
  canonical hyphen (`461-468`, matching gold) and render applies the en-dash per style via
  `formatPageRange`. Strict F1 → ~0.99; user output unchanged (`461–468`). The cheapest high-value fix
  in the system, now banked.
- **`isbn` canonical F1 = 0.31** — worst field, violates its own 0.90 coverage floor.
- **Author parsing breaks** (`utils/authors.ts`, `phase5AuthorDisambig.ts:58-72`): corporate authors
  *with a comma* parse as persons; non-Latin/particle names mis-segment (the first real-gold row
  `Кирчанов, Максим` is a known failure); **"et al" is silently stripped at full confidence** with no
  "list incomplete" flag.
- **3 of 9 styles are CSL stubs that silently fall back to APA** (chicago-notes-bib, ama, acs) — a
  user picks AMA and gets APA-shaped output with only a `render_style_fallback` warning. The other 6
  are hand-rolled and mature.
- ~~**Health blind to *high-confidence-wrong***~~ → ✅ **FIXED (2026-06-25).** `detectImplausiblePresentFields`
  in `phase10Health.ts` now flags mis-segmented authors (year/locator/DOI leaked into the span, or
  implausibly long) and reversed page ranges as `suspect_author_value` / `suspect_locator_value` (review
  severity → `needs_review`). 76/1000 caught, all true positives; clean refs stay `ready`. (The underlying
  author *parser* and isbn F1 are still unfixed — health now flags them rather than emitting them silently.)
- **Biggest single quality lever: turn on enrichment for identifier-bearing refs** (77% have a DOI).
  It fixes container fields + author lists + pages + ISBN simultaneously — which is why **B (verify
  enrichment) is the highest-ROI item in this whole document.**

> Note: the `eval-real-input.mts` harness now reports **STRICT vs FAIR** dual scores — STRICT catches
> the wrong-glyph/`pages` class of defect; FAIR credits faithful extraction of degraded input. That
> split is exactly the right instrument: it separates "the engine's job (extract faithfully)" from
> "enrichment's job (resolve to canonical)."

# The meta-insight

Six concrete blockers gate most of the system's latent value. None require rearchitecting:

| # | Unlock | Effort | Payoff | Status (2026-06-25) |
|---|---|---|---|---|
| 1 | **Fix `pages` en-dash normalization** | Trivial (1 field) | Removes the most-visible live defect on every ref | ✅ **Done** — field=hyphen, render=en-dash, live |
| 2 | **Verify + enable enrichment** (fixture replay) | Small (80% scaffolded) | Largest single jump in correctness for ~77% of refs | ✅ **Enabled** behind `FEATURE_LIVE_ENRICH` (default off) + cache + budget — flip to go live |
| 3 | **DeterministicResolver: DOI-first migration** | Medium, parity-locked | Stops the monolith growing; deletes >adds | ◑ **DOI slice landed** — seam wired, parity-locked (0 diffs / 6000 evals); pmid/isbn/arxiv/year remain |
| 4 | **Add train/val/test split** to the data builder | Trivial (few lines) | Unblocks one honest, promotable live model | ◑ **Partial** — build no longer 500s, but `build_real_train.py` still writes all `train` → promotion gate (val>0 && test>0) still blocked |
| 5 | **Delete dead BullMQ + fix 4× normalization** | Small | Removes false durability; latency win | ✅ **Done** — `queue/` deleted; 4×→1× normalize (parity-proven) |
| 6 | **Decompose `AdminTraining.tsx`** (7,473 lines) | Medium | Maintainability of the HITL core | ◑ **Partial** — 3 dialogs extracted, 7,473→6,797; editor dialog remains |

Extra fixes shipped this session, beyond the original six: **health confident-wrong flags**, **OCR-fold
DOI recovery** wired into enrichment lookup, **BIO build dataset-selection hardening**, **grobid CI**, and
the **Vercel 404**.

Recommended remaining order: **2 (enable) → 4 (split) → 3 (monolith) → 5 → 6.** (Flip the proven enrichment
win on first, then close the flywheel with an honest model, then the structural cleanup.)

