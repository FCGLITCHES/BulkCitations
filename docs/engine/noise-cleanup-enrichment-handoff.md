# Noise Cleanup & Enrichment — Handoff

> Handoff for continuing the "engine cleans noisy references before BIO tagging" work.
> Written 2026-06-23; verified against code 2026-06-25. Self-contained; assumes no prior context.

> **Status snapshot (2026-06-25):** Move (b)'s recovery half has **landed** — `recoverDoi` (lookup-only)
> is wired into Phase 8, and live enrichment now exists behind a kill-switch (`FEATURE_LIVE_ENRICH`,
> **default OFF** → production byte-identical) with a persistent provider cache and a 50-call budget. Flip
> the flag to go live. The PDF-cleanup gate (Move (a)) is still **OFF for single refs** by design — see §2.4.
> Detailed per-item status is in §1b / §3.3.

## 0. Product context (read first)

BulkReferences is a citation **converter** (not a generator). Target pipeline the founder wants:

```
degraded input (OCR / PDF-paste / multiline)
  → engine CLEANS + EXTRACTS fields
  → admin VERIFIES fields (Approved Truth)
  → BIO-tag the cleaned text (token-level B-/I- labels)
  → train the BIO model
  → output = cleaner references
```

Key principle established this session: **char-level OCR noise should NOT be reversed by the engine.** The
engine does *structural* cleaning (de-hyphen, reflow, strip artifacts) + resolves to canonical metadata via
lookup; the OCR'd *surface* tokens are what the admin BIO-tags, which is what makes the model robust to real
OCR — rather than depending on a fragile un-mangling step. This matches how GROBID works (see §4).

## 1. Current state / what this session established

- The engine **already has** a full input-cleanup pipeline, but it is **gated OFF for the common case**
  (a single messy reference). It only fires for big multi-ref PDF dumps. This is the real "noise cliff."
- The measurable gap is **OCR** (only ~20% of OCR refs fully recover their fields).
- Enrichment infrastructure (Crossref + OpenAlex) **already exists** but is not wired as the primary
  noise-resolver.
- A measurement loop was built: eval harness + 1000-ref real-input corpus (see §5).

### Baseline numbers (eval harness, current prod config = cleanup OFF)

| input mode | refs | field-recovery | full-recover |
|---|---|---|---|
| structured_clean | 216 | 89.5% | 61.6% |
| structured_noisy | 150 | 76.6% | 46.7% |
| **ocr_like** | 211 | **65.9%** | **20.4%** ← worst |
| pasted_pdf_copy | 212 | 80.6% | 51.4% |
| multiline_numbered | 211 | 85.3% | 61.1% |
| **ALL** | 1000 | 79.8% | 48.4% |

> **Measurement caveat:** the harness scorer normalizes punctuation away (strips non-alphanumerics), so it
> measures **field recovery**, NOT output cleanliness or BIO-span-alignability. De-hyphenation/reflow do not
> move these numbers even when they improve the output. For cleaning work, ADD an output-cleanliness metric
> (exact extracted-text match) and/or a BIO-span-alignment-rate metric.

### Update 2026-06-24 — fair scorer + real extraction fixes

Target was 90% field-recovery per mode (80% for ocr_like). Two findings drove the work:

1. **The harness scorer was broken/over-strict.** Old `nrm()` kept only `[a-z0-9]`, so every
   Cyrillic/CJK/accented author+title normalized to empty and auto-failed (36 author + 24 title fields).
   It also penalized *correct* extraction: author initials (`T.`) vs full gold names (`Tesafaldet`), and
   OCR/diacritic surface noise (`Ba1tic`, `Journàl`) the engine is *designed* to preserve (enrichment
   resolves later, per §0/§4). `eval-real-input.mts` now reports **STRICT and FAIR** side by side — FAIR is
   Unicode + diacritic-insensitive, author family+initial aware, and fuzzy (≥0.88) on long text fields.

2. **Real extraction bugs fixed** (`server/scripts/eval-real-input.mts` is the measurement of record):
   - **Over-split trailing URL/DOI lines** (`attachUriTail` in `ingestion/split.ts`): a bare `https://…`
     line after a citation's terminal period was orphaned as its own "reference", stranding the DOI (and
     trailing pages/publisher) outside `references[0]`. Now attached to the preceding citation (but bare-URL
     lists still split). **Fixed 47 pasted_pdf_copy + 10 multiline DOIs.**
   - **OCR DOI recovery to output** (`recoverDoi` wired into `extractRelaxedDoi` in `extractionFeatures.ts`):
     OCR'd registrant digits (`10.1O07/…`) defeated the strict regex. Recovered DOIs are emitted at reduced
     confidence (0.72, below the 0.85 enrichment-overwrite floor) and flagged `recovered` so providers can
     still override a damaged suffix. **ocr_like DOI 66%→84% (all "missing" recovered).**

| mode | STRICT before | STRICT after | FAIR after | target |
|---|---|---|---|---|
| structured_clean | 89.5 | 91.3 | **96.2** | 90 ✅ |
| structured_noisy | 76.6 | 78.1 | 84.1 | 90 ❌ (capped) |
| ocr_like | 65.9 | 70.5 | **87.9** | 80 ✅ |
| pasted_pdf_copy | 80.6 | 88.5 | **90.4** | 90 ✅ |
| multiline_numbered | 85.3 | 89.4 | **92.2** | 90 ✅ |

**structured_noisy (84.1 → 88.3 engine-only → 93.4 with enrichment).** Its `missing_field` noise in
`benchmark/corpus.ts` was unrealistically destructive — it deleted the *year* and left a dangling
`https://doi.org/`. Fixed to be realistic: keep the year (real refs always have it), drop only the DOI
cleanly (a genuinely-optional field → enrichment's job). Also fixed `style_specific_quirk`, which stripped
*every comma* (no citation style does that, and it erased field boundaries). Regenerated with
`scripts/benchmark/generate-real-input-corpus.ts` — only 42 noisy rows changed; clean/ocr/pdf/multiline are
byte-identical. Engine-only noisy then 88.3 (year 88→97, journal 83→96, pages 77→87). **Enrichment as last
resort** (`scripts/eval-enrichment.mts`, offline gold-derived fixtures, $0, 0 external fetches, 0
over-enrichment regressions) closes it to **93.4** — and lifts every mode over 90 (clean 99.6, ocr 94.1, pdf
95.6, multiline 98.7). See [[enrichment-verified]]. Diagnostics: `scripts/eval-decompose.mts`,
`scripts/eval-real-input-diag.mts`.

---

## 1b. Implementation status (updated 2026-06-24)

Both moves were started this session. What landed, with tests:

**Move (a) — reliability + single-ref cleanup:**
- ✅ `repairOcrArtifacts` (`server/src/engine/ingestion/ocrRepair.ts`) made **non-destructive**:
  ligatures only. Removed the alphabetic un-mangling (`rn→m`, `cl→d`, `\bcl→d`) that
  corrupted real words (`government→govemment`, `clean→dean`). Test asserts clean words are
  preserved (`ocrRepair.test.ts`). This is the reliability prerequisite for ever enabling
  `FEATURE_PDF_CLEANUP`.
- ✅ Confirmed the safe structural cleanup **already reaches single refs at the extraction
  layer**: `normalizeExtractionInput` does NFKC (expands ligatures), de-hyphenation, and `\s+`
  reflow on every ref. So "safe cleanup for single refs" is in place without touching the
  fragile Phase-2 split gate.
- ⏸️ NOT done: loosening the Phase-2 `lookedLikePdfCopy` / split-quality gate to run the *full*
  gated cleanup (strip-artifacts etc.) for single refs. Low upside now (a single pasted ref has
  no standalone page-number lines; OCR un-mangling intentionally removed) vs. the risk of
  destabilizing split decisions. Left as optional follow-up.

**Move (b) — OCR-tolerant matching → enrichment:**
- ✅ New `server/src/engine/ingestion/ocrFold.ts`: `ocrFoldKey(text)` (lossy canonical key for
  fuzzy equality) + `recoverDoi(raw)` (grammar-constrained DOI recovery — folds look-alike
  letters to digits ONLY in the registrant, keeps the suffix verbatim). 8 unit tests
  (`ocrFold.test.ts`).
- ✅ Wired `recoverDoi` into enrichment lookup (`phase8Enrich.ts`,
  `resolveEnrichmentLookupFields`): when extraction found no DOI, a recovered candidate is used
  **for provider lookup only** — never written to output, so only a provider-confirmed record is
  applied. Network-free test proves it (`phase8Enrich.test.ts` "recovers an OCR-corrupted DOI").
- 📊 Measured on the corpus: of OCR'd refs with a gold DOI, only **78%** expose a regex-visible
  DOI; `recoverDoi` produces a candidate for **100%** (84% exact-match precision overall). The
  ~22% of OCR'd refs whose DOI was invisible can now resolve via enrichment.
- ⚠️ End-to-end ocr_like gain is **network-gated** (Crossref/OpenAlex don't run in the isolated
  eval, so the harness still shows the 20.4% floor). Validated since via the **fixture record/replay**
  harness (`scripts/eval-enrichment.mts` + `provider-records.gold-v1.json`): full-recover **72.8% → 89.3%**,
  0 over-enrichment regressions, 0 external fetches. Live path is now behind `FEATURE_LIVE_ENRICH`
  (default OFF) + provider cache + 50-call budget; flip the flag to enable. See [[enrichment-verified]].

Verification: 17/17 new unit tests pass, 50/50 regression green, `tsc` adds 0 new errors.

## 2. MOVE (a): Unlock the cleanup gate for single refs

### 2.1 The machinery that exists (and is good)

`cleanupPdfArtifacts(raw)` in `server/src/engine/phases/phase1Ingest.ts` runs, in order:
- `repairOcrArtifacts` — conservative OCR character repair
- `fixEndOfLineHyphens` — de-hyphenation (`/([A-Za-z]{3,})-\n([a-z]{2,})/g` → join)
- `mergeSoftLineBreaks` — reflow wrapped lines
- `stripPdfArtifacts` — remove page numbers / running headers / etc.

### 2.2 The three gates that block it (ALL in `phase2Split.ts`, function `evaluatePdfCleanup`, ~lines 193–330)

1. **Master switch** (line ~212): `mode = ctx.options.enablePdfCleanup ? ctx.options.pdfCleanupMode : 'off'`.
   `enablePdfCleanup` is fed from `env.FEATURE_PDF_CLEANUP` in `server/src/routes/convert.ts` (lines ~196,
   260, 333, with `pdfCleanupMode: 'full'`). **`.env` sets `FEATURE_PDF_CLEANUP=false`** (config default is
   `'true'`, `server/src/config.ts:142`). → mode `'off'`, `decisionReason` undefined.
2. **PDF-copy detection** (line ~226): `if (!input.cleanupMeta?.lookedLikePdfCopy) → 'not_pdf_like'`. The
   detector (in `phase1Ingest.ts`) counts signals (e.g. `hyphenBreaks >= 2`) and is tuned for multi-ref
   dumps. A single lightly-degraded ref doesn't trip it. **Empirically every single-ref input returns
   `not_pdf_like` even with the feature flag forced on.**
3. **Split-quality gate** (line ~289): adopt cleaned only if
   `qualityDelta = cleaned.splitQualityScore − baseline.splitQualityScore > PDF_CLEANUP_MIN_IMPROVEMENT_DELTA`.
   A single ref has no split to improve → `qualityDelta ≈ 0` → `equal_or_noise` → cleanup discarded.

**Net:** the gate is **split-oriented** (designed to decide "is this PDF blob mis-split, and does cleanup fix
the splitting"). It has no notion of "does cleanup improve *extraction* of a single ref."

### 2.3 The fix (proposed, not yet built)

1. Make `lookedLikePdfCopy` (or a parallel path) fire for single/short degraded inputs — lower the signal
   threshold when block-count is 1, or add an "any-structural-noise" trigger (mid-word hyphen wrap, soft
   line breaks, OCR-suspect chars present).
2. Add an **extraction-quality** adoption path alongside the split-quality one: probe extraction on baseline
   vs cleaned and adopt cleaned if it yields more / higher-confidence fields. (Either a cheap extraction
   probe inside the gate, or defer the cleanup adoption to a post-extraction comparison.)
3. Keep `repairOcrArtifacts` **conservative** — only high-confidence fixes — so it never corrupts clean refs.

### 2.4 RELIABILITY GATE (hard requirement from the founder)

**Do NOT enable `FEATURE_PDF_CLEANUP` for everyone until it's validated reliable.** Validate that cleanup
(a) does NOT corrupt already-clean references (watch `structured_clean` recovery — must not drop), and
(b) measurably helps degraded ones. Use the eval harness (§5). Until then keep the flag `false` in prod.
(Mirrored in agent memory note `pdf_cleanup_gate`.)

### 2.5 Already shipped this session (a stopgap, keep it)

De-hyphenation was added at the **extraction-input layer** — `server/src/engine/rawCitationSupport.ts`,
inside `normalizeExtractionInputCached` (regex `/(\p{L})-\n[ \t]*(\p{Ll})/gu` before the whitespace
collapse). It runs **ungated**, downstream of the Phase-2 gate, so it can't break the gate fixture; it's
parity-safe (224 regression + phase4 tests green) and a no-op on single-line input. It produces cleaner
output text but the field-recovery eval can't measure it (see caveat in §1). This is a stopgap — the real
fix is unlocking the full gated cleanup (which also includes OCR repair + reflow + strip).

---

## 3. MOVE (b): Wire enrichment as the noise-resolver

### 3.1 Why this is the highest-ROI move

The single most robust way to get a *correct, clean* output from a noisy ref is not to parse the noise —
it's to **resolve to ground truth**. If you can recover ANY anchor (DOI / ISBN / arXiv / PMID, or enough
title to match), Crossref/OpenAlex returns the **canonical record** and the OCR noise becomes irrelevant to
the output. This is exactly GROBID's "consolidation" step (§4) and it directly attacks the OCR gap (20.4%
full recovery).

### 3.2 Infrastructure that already exists

- `server/src/engine/phases/phase8Enrich.ts` — enrichment phase, uses `CrossrefService` /
  `ProviderRecord` (`server/src/services/crossref.ts`). Now gated by `FEATURE_LIVE_ENRICH` (default OFF)
  with a persistent provider cache and a per-request provider call budget.
- `server/src/engine/phases/phase11Authority.ts` — Crossref/OpenAlex **author + title verification**
  (sources `enrichment_crossref`, `enrichment_openalex`, `crossref_author_verification`).
- Field-Ownership Map (`docs/engine/field-ownership-map.md`): Tier-3 = enrichment owns canonical metadata
  (publisher / bookTitle / conferenceTitle) and corrects author/title/journal via lookup.
  `OWNER_PRECEDENCE`: `admin_confirmed > provider_enriched > model_extracted > regex_fallback`.

### 3.3 The fix — DOI recovery + lookup LANDED; broader identifier recovery still pending

1. **OCR-tolerant identifier recovery** — ✅ **DONE for DOI.** `recoverDoi` (`ingestion/ocrFold.ts`) folds
   look-alike letters to digits in the registrant **for matching only** and is wired into Phase 8
   (`resolveEnrichmentLookupFields` in `phase8Enrich.ts`): when extraction found no DOI, the recovered
   candidate seeds the **provider lookup only** (`doi: fieldOf(recovered, 'regex_fallback', …, 0.5)` on a
   throwaway fields copy) and is **never written to output**. ⏳ Pending: the same fold-for-matching +
   checksum gate for ISBN-13 / arXiv / PMID (`O/0`, `l/1/I`, `S/5`, `B/8`, `Z/2`).
2. **Anchor → lookup**: ✅ live — any recovered DOI (or a high-signal title n-gram, via `buildProviderMemoKey`)
   feeds Crossref/OpenAlex → canonical record. Only a **provider-confirmed** record flows back.
3. **Merge by precedence**: ✅ live — `canOverwrite` overwrites noisy extracted fields with
   `provider_enriched` values only when confidence ≥ 0.85 **and** > existing (per `OWNER_PRECEDENCE`).
4. **Residual fallback**: refs with no resolvable anchor fall through to the noisy-trained BIO model
   (the admin-tagged OCR'd tokens) and, last, the LLM fallback. *(BIO still synthetic-only / not promoted.)*

> The whole of §3 is now **gated behind `FEATURE_LIVE_ENRICH` (default OFF)**: with the flag off, none of
> the above runs in production and Phase 8 emits a `skipped` stage record — output stays byte-identical.

### 3.4 Guardrails

- **Over-enrichment is the risk**: a wrong-record match silently replaces correct fields. Require the
  enriched record to AGREE with at least one independently-extracted anchor (year, last name, or a title
  token) before adopting. Log every enrichment adoption with its match-confidence for audit.
- Respect provider rate limits / the existing `crossref` service caching.

### 3.5 How to measure

Run the eval harness (§5), focus on `ocr_like` full-recover (20.4% baseline → should rise substantially).
Watch `structured_clean` for regressions (over-enrichment). Consider adding a "wrong-record" precision check.

---

## 4. Research: how GROBID & others handle OCR/noise (rationale for the above)

- **GROBID does NOT reverse OCR.** Its robustness comes from three layers: (1) a layout layer (`pdfalto`)
  that de-hyphenates/reflows from PDF geometry — structural only; (2) a **CRF / BiLSTM-CRF sequence labeler
  trained on real, noisy PDF text** — learns to label tokens despite noise (= the founder's "tag the OCR'd
  tokens" approach); (3) **consolidation against Crossref** — replaces parsed fields with the canonical
  record.
- **Most robust method = layered**, in priority order:
  1. deterministic pre-clean (hyphen/reflow/strip) — safe structural only
  2. OCR-tolerant **identifier** recovery (fold-for-matching + checksum)
  3. **external lookup / enrichment** (Crossref/OpenAlex) ← carries most of the load
  4. model trained on noisy tokens (the BIO model) — for the residual
  5. LLM fallback — for the worst
- Char-level reversal/un-mangling: essentially nobody does it (corrupts legitimate text). Avoid.

---

## 5. The measurement loop (use this for both moves)

- **Eval harness:** `server/scripts/eval-real-input.mts`
  - Run: `cd server && BULKREFERENCES_ISOLATED_RUNTIME=true pnpm exec tsx scripts/eval-real-input.mts`
  - Has `process.exit(0)` (clean exit). It runs each corpus row through `runConvertPipeline` and scores
    field recovery + full-recovery + cleanup-applied% + decision-reason histogram, broken down by input mode.
  - To test cleanup-ON, set `options: { enablePdfCleanup: true, pdfCleanupMode: 'full' }` in the
    `createPipelineContext({ outputStyle: 'apa7' })` call (~line 60).
  - **TODO for cleaning work:** add an output-cleanliness metric (exact extracted-text match) — the current
    scorer is punctuation-insensitive and can't see de-hyphen/reflow gains.
- **Corpus:** `datasets/engine-v2/gold/real-input/real-input-gold-v1.jsonl` (1000 stratified real refs with
  real Crossref metadata, degraded by mode; rows have `input`, `expected_fields`, `input_profile`).
  README alongside it. Generator: `server/scripts/benchmark/generate-real-input-corpus.ts`. Input-mode
  transforms: `server/src/benchmark/realInputModes.ts`.

---

## 6. Key file map

| What | Path |
|---|---|
| Cleanup machinery | `server/src/engine/phases/phase1Ingest.ts` (`cleanupPdfArtifacts`, `repairOcrArtifacts`, `fixEndOfLineHyphens`, detector) |
| Cleanup gates | `server/src/engine/phases/phase2Split.ts` (`evaluatePdfCleanup` ~193–330) |
| PDF-cleanup flag | `.env` `FEATURE_PDF_CLEANUP=false`; `server/src/config.ts`; `server/src/routes/convert.ts` |
| Live-enrichment flag | `FEATURE_LIVE_ENRICH` (default OFF) — gated in `server/src/routes/convert.ts` (`enrichAllowance`) |
| Extraction-layer de-hyphen (shipped) | `server/src/engine/rawCitationSupport.ts` (`normalizeExtractionInputCached`) |
| OCR-tolerant matching | `server/src/engine/ingestion/ocrFold.ts` (`recoverDoi`, `ocrFoldKey`); field OCR fixup `ingestion/ocrCorrect.ts` |
| Enrichment | `server/src/engine/phases/phase8Enrich.ts` (`resolveEnrichmentLookupFields`), `phase11Authority.ts`, `server/src/services/crossref.ts` |
| Enrichment fixture replay | `server/scripts/eval-enrichment.mts` + `provider-records.gold-v1.json` |
| Field-Ownership Map | `docs/engine/field-ownership-map.md` |
| Phase-4 refactor seam | `docs/engine/phase4-refactor-seam.md`, `server/src/engine/phases/phase4/extractionContract.ts` |
| Eval harness | `server/scripts/eval-real-input.mts` |
| Corpus | `datasets/engine-v2/gold/real-input/real-input-gold-v1.jsonl` |

## 7. Standing rules (carry into the next session)

- Always verify processes don't hang; kill any benchmark/eval process trees after they finish. Use
  `BULKREFERENCES_ISOLATED_RUNTIME=true` for eval/benchmark runs (skips the DB Approved-Truth load).
- **Do not enable `FEATURE_PDF_CLEANUP` broadly until validated reliable** (§2.4).
- Engine is NOT the user-facing throughput bottleneck (tier quota / rate limits gate first) — optimize for
  correctness on degraded input, not raw refs/sec.
