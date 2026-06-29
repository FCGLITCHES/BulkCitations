# Phase 4: Extract

## Source

- `server/src/engine/phases/phase4Extract.ts` — the stage (a ~25k-line monolith; see "Known shape" below)
- `server/src/engine/extractionFeatures.ts` — deterministic one-pass identifier/year/quoted-title extraction
- `server/src/engine/identifierUtils.ts` — checksum/format validation + normalization for every identifier
- `server/src/engine/rawCitationSupport.ts` — input normalization, parseable-raw derivation, year/quoted-title scoring
- `server/src/engine/phases/phase4/extractionContract.ts` — the typed `DeterministicResolver` seam (`resolveDoi` is the first wired slice)

## Purpose

Phase 4 turns a single split reference's text into **structured fields**. It is the core hand-off from raw citation text to canonical reference data, and it dominates both the benchmark field scores and user-visible output quality.

Each field it emits is carried as `{ value, source, confidence, origin }` on the `ReferenceCarrier`. Phase 4 does not own canonical metadata lookup (that is Phase 8 Enrich) — it recovers what is *present in the text*, validates identifiers, and reconciles overlapping signals into a single best value per field.

## Pipeline Position

```
P1 Ingest → P2 Split → P3 StyleDetect → [P4 Extract] → P5 AuthorDisambig → P5.8 StructuralFamilyRouter
→ P6 TypeClassify → P6.5 LLMFallback → P6.8 SharedRepair → P7 Normalize → P8 Enrich → P9 Dedup
→ P10 Health → P11 Authority → P12 Render → P13 FeedbackLoop
```

Phase 4 runs after style detection (so it knows the `StyleFamily`) and feeds disambiguation, type classification, normalization, and enrichment downstream. The values it produces are the substrate the rest of the pipeline corrects and renders.

## Inputs

- Styled `ReferenceCarrier[]` from Phase 3 (each carries `raw` text, a detected `style.family`, and a provisional `type`).
- `PipelineContext` — in particular `executionPolicy.parseProfile`, `executionPolicy.extractionMl`, and debug flags.

## Outputs

Phase 4 populates the carrier field set. The fields it can produce (see `ExtractableField` in `extractionContract.ts`):

- **Free-text spans:** `authors`, `title`, `journal`
- **Identifiers:** `doi`, `url`, `pmid`, `arxiv`, `isbn`, `issn`, `handle`, `patent`
- **Structured locators:** `year`, `volume`, `issue`, `pages`
- **Container / contextual:** `publisher`, `bookTitle`, `conferenceTitle`, `edition`, `placeOfPublication`, `thesisType`, `institution`, `repository`, `siteName`

Alongside the fields it writes:

- per-field confidences and a list of uncertain fields (confidence `< 0.7`);
- `extractionMeta` (run mode, model version, ML errors, shadow diffs);
- health evidence so later phases can distinguish grounded spans from inferred field text;
- BIO/native ML diagnostics when an ML run produced them (tokens, labels, offsets, merged entities).

## Tiering: deterministic vs heuristic vs ML

Phase 4 produces field values from three tiers, in this precedence (identifiers are authoritative because they are checksum-validated; ML patches and enrichment only override under confidence gates):

### Tier 1 — Deterministic identifiers (the reliable core)

`extractCitationFeatures(raw, family)` does a single normalization pass and extracts every identifier plus the best `year` and any quoted title. Identifier candidates are run through `identifierUtils.ts`, which **format- and checksum-validates** them: ISBN-10/13 and ISSN check digits, DOI/arXiv/handle/patent grammar. A value that fails validation is dropped rather than emitted wrong. This tier is deterministic, cached, and independent of the ML service.

### Tier 2 — Heuristic free-text spans (the bulk of the monolith)

Authors, title, and journal/venue are recovered by heuristics — `extractCandidatesFromFeatures` → `parseStructuredReference` plus dozens of per-style regexes (APA/Harvard/MLA/Chicago/Vancouver/IEEE article and in-collection patterns, webpage/thesis/report/conference cues). These segment the text into spans, then a large body of repair/guard logic reconciles them (e.g. recovering author overflow, splitting conference-title aliases off the title, demoting a conference title that is really a repository/preprint, recovering title continuations that spilled into publisher). This is where most of the file's size lives, and it is the default path.

### Tier 3 — ML on the residual (gated, off by default)

An ML extractor can run on top of the heuristic result, but it is **selective-patch only — it never wholesale-replaces the heuristic output.** Routing is decided per carrier (`heuristic` | `shadow` | `primary`) and gated two ways:

- **Execution policy:** `executionPolicy.extractionMl` (`off` forces pure heuristic, e.g. the `core_parse_fast` profile).
- **`ML_PHASE4_MODE`** (env / runtime override), parsed to `heuristic` (default), `shadow`, or `primary`. Anything unrecognized falls back to `heuristic`, so **ML is off unless explicitly enabled.**

In `shadow` mode the ML result is computed and diffed but not adopted. In `primary` mode, `applyPhase4Selection` builds a *selective patch* (`buildPrimaryMlPatchPrediction`) and merges only those fields over the heuristic baseline; if the patch is empty or a blocking BIO diagnostic fires, it falls back to heuristic. BIO diagnostics are forwarded into health evidence either way.

## The DeterministicResolver seam

`phase4/extractionContract.ts` is the typed seam for an in-progress effort to shrink the monolith by moving identifier resolution behind a stable `DeterministicResolver` interface (mirroring the Field-Ownership Map: deterministic owns identifiers + locators, BIO owns free-text spans, enrichment owns canonical metadata).

**First wired slice:** DOI. Phase 4 no longer inlines DOI selection — it calls `resolveDoi(citationFeatures)` (line ~3676). That function returns `{ value, confidence, spanText }` or `null`, replicating the old inline behavior exactly:

- `value` = the normalized ("relaxed") DOI;
- `confidence` = `0.98`, or `0.72` when the DOI was **OCR-recovered** (a misread registrant digit folded back by `recoverDoi`). The reduced confidence keeps recovered DOIs below the `0.85` enrichment-overwrite floor so a provider lookup can still correct them;
- `spanText` = the strict regex match when available, else the value.

**This is a seam, not a finished migration.** Only DOI flows through the resolver today; PMID, arXiv, ISBN, ISSN, handle, patent, year, volume, issue, and pages are still read inline off `citationFeatures.identifiers.*` in `phase4Extract.ts`. The rest of the contract file (`BioSpanProvider`, `ResidualPolicy`, `FieldMerger`, `OwnerConfidencePolicy`) is types-only and not wired.

## Field-specific notes

- **`pages` is stored as canonical ASCII hyphen.** `normalizePages` collapses en-/em-dashes and dash runs to a single `-`, expands abbreviated ranges (`123-9` → `123-129`), and stores the result as data. Typographic presentation (en-dash for APA/MLA/Chicago, hyphen for Vancouver) is applied later in Phase 12 Render, not here. Storing the en-dash in the field previously leaked presentation into the data and mismatched the (hyphenated) gold on every range.

- **ISBN print-vs-electronic selection (Springer/Apress) is OCR-tolerant.** When no literal ISBN is present, Phase 4 can infer one from a Springer-family DOI slug, preferring the *print* ISBN (the electronic-minus-one for these imprints). `shouldPreferSpringerPrintIsbn` recognizes Springer/Apress/Bohn Stafleu van Loghum imprints, and falls back to confusable-folding (`foldedTextHasSpringerImprint`) so degraded publisher text like "Sprinqer"/"Springcr" still triggers the print preference.

- **Cross-identifier inference:** when no explicit value exists, arXiv can be inferred from a `10.48550/arXiv.*` DOI, and ISBN from a book/chapter DOI slug — both at reduced confidence.

## Known shape (the monolith)

`phase4Extract.ts` is a known oversized file (~25,000 lines). It is being migrated incrementally onto the `extractionContract.ts` interfaces, move-only, with output parity guarded by benchmark field/contract hashes. Treat it as: a thin orchestrator (`Phase4Extract.run` → build heuristic result → select routing plan → apply ML selection → run repair passes) wrapped around a very large library of style/repair heuristics. New deterministic work should land behind the resolver seam rather than as more inline branches.

## Operational notes

- The deterministic identifier tier is the reliable core; heuristics carry the free-text load and remain the default. ML is a gated, selective-patch enhancement on the residual, not a replacement.
- `core_parse_fast` skips ML and candidate-envelope prebuild for throughput; richer profiles (`core_parse_full*`, `pro_overlay_enrich`, `debug_full`) enable routed ML and fuller diagnostics.
- Carriers on the DOI fast path (`carrier.doiFastPath`) bypass heuristic extraction entirely.
