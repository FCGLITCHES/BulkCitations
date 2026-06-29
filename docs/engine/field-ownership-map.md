# Field-Ownership Map

Status: **design contract** (drafted 2026-06-22). Owner: engine.

This document decides, **per extracted field, which subsystem is authoritative** for producing it.
It is the contract that:

1. The **Phase 4 refactor** ([phase4-refactor-seam.md](phase4-refactor-seam.md), typed contract
   `server/src/engine/phases/phase4/extractionContract.ts`) is organized around — base extraction,
   identifier resolvers, the BIO routing seam, validation, and normalization map 1:1 to the owners
   defined here. The map is encoded executably there as `FIELD_OWNERSHIP` + `OWNER_PRECEDENCE`.
2. The **gold-dataset / BIO-tagging work** keys off — it tells the labeling effort which fields BIO must be
   excellent at, and which fields it should **not** spend labeling budget on.
3. The **tiered execution model** is derived from — owners map directly to runtime tiers, which is where the
   throughput headroom comes from.

It does **not** change runtime behavior on its own. It is the target architecture that the refactor converges
on, parity-locked, until the BIO evidence gates exist.

> **Wiring status (2026-06-25):** the map is executable as `FIELD_OWNERSHIP` / `OWNER_PRECEDENCE` in
> `extractionContract.ts`, but only **one** deterministic slice is live behind the seam so far —
> `resolveDoi` (DOI), which replaced the inline DOI block parity-locked byte-identical. Everything else
> (pmid/isbn/arxiv/year resolvers, the `BioSpanProvider`, `FieldMerger`, `ResidualPolicy`) is types-only.
> See [phase4-refactor-seam.md](phase4-refactor-seam.md).

---

## The principle

> Give each field to the subsystem that **structurally wins** for that field — not to whichever one happens
> to score highest on today's (clean, synthetic) benchmark.

BIO sequence tagging, deterministic pattern matching, and provider enrichment each have a *shape* of problem
they are uniquely good at. The weak BIO fields (bookTitle, URL, publisher) should not be "improved with more
labels" — they should be **removed from BIO entirely** and given to the owner that can never lose them.

This mirrors the existing correction hierarchy enforced by `canOverwrite` in
`server/src/engine/types/field.ts` (admin_confirmed > provider_enriched > model_extracted > regex_fallback >
empty; enrichment overwrites only when confidence ≥ `ENRICHMENT_OVERWRITE_THRESHOLD` (0.85) **and** strictly
greater than the existing value — `server/src/engine/overwrite-policy.ts`). The ownership map refines that
hierarchy by declaring, per field, **which producer is expected to be authoritative** so the engine can set
confidence and abstain behavior correctly instead of treating every producer as equal.

---

## The three owners

| Owner | Problem shape it wins | Mechanism | Maps to correction-hierarchy origin |
| --- | --- | --- | --- |
| **Deterministic** | Tokens with a hard, self-describing format or a fixed grammar near an anchor | regex + checksum + format validation, over the shared `CitationFeatures` one-pass | `regex_fallback` (high-confidence when format+checksum valid) |
| **BIO (ML)** | Free-text spans whose boundaries depend on context — "where does the author list end and the title begin" | ONNX token classification → entity spans | `model_extracted` |
| **Enrichment** | Canonical metadata that is better *looked up* than *extracted* once an identifier is known | Crossref / OpenAlex lookup keyed on a deterministic identifier, governed by the ≥0.85 overwrite gate | `provider_enriched` |

---

## Per-field ownership table

Evidence columns:

- **BIO F1**: entity-exact F1 of the current extractor on its test split — **synthetic bootstrap data**, treat
  as directional only (`ml-service/models/current/metadata.json`).
- **Heuristic (clean / noisy)**: field F1 from the grobid-pmc full corpus, clean vs noisy
  (`benchmarks/grobid-pmc/results/full.*` @ 2026-04-21; being refreshed in Step 0).

| Field | **Primary owner** | Fallback chain | BIO F1 | Heuristic clean / noisy | Rationale |
| --- | --- | --- | --- | --- | --- |
| **doi** | Deterministic | → enrichment cross-check | 0.76 | 1.00 / 0.66 | Hard format + can be validated/resolved. Noise-tolerant regex over `CitationFeatures` owns it; never ask BIO to tag a DOI. |
| **url** | Deterministic | — | 0.19 | ~1.00 / — | Pure pattern. BIO is hopeless here (0.19); regex is decisive. |
| **isbn** | Deterministic + checksum | → enrichment | n/a | 0.91 / — | ISBN-10/13 checksum is a free correctness oracle. **Protected coverage floor 0.90.** |
| **issn** | Deterministic + checksum | → enrichment | n/a | 0.99 / — | Same as ISBN — checksum-validated format. |
| **pmid / arxiv / handle / patentNumber** | Deterministic | — | varies | high / — | Self-describing identifiers with fixed grammars. |
| **year** | Deterministic | → BIO tiebreak | 0.90 | ~1.00 / — | 4-digit + plausibility range. BIO only consulted when multiple year candidates collide. |
| **volume** | Deterministic | → BIO tiebreak | 0.93 | 0.99 / — | Grammar near journal/issue. BIO breaks volume↔issue↔year ambiguity on noisy refs. |
| **issue** | Deterministic | → BIO tiebreak | 0.88 | 0.99 / — | Same as volume. |
| **pages** | Deterministic | → BIO tiebreak | 0.84 | 0.99 / — | `NN–MM` / `e1234` grammar. |
| **author** | **BIO** | → deterministic split → enrichment (canonical list) | 0.71 | 0.95 / **0.55** | **The flagship BIO field.** Boundary detection in free text is exactly what sequence labeling wins and regex loses (heuristic collapses to 0.55 on noise). |
| **title** | **BIO** | → deterministic (quoted-title cue) → enrichment | 0.68 | 0.99 / — | Title↔author and title↔container boundaries need context. Deterministic only wins when an explicit quote/delimiter cue exists. |
| **journal / venue** | **BIO** | → deterministic → enrichment | 0.63 | 0.99 / — | Container-name segmentation; enrichment supplies the *canonical* name once DOI is known. |
| **publisher** | **Enrichment** | → deterministic | 0.26 | 0.99 / — | BIO 0.26 — structurally a lookup field. Crossref/OpenAlex returns it reliably given DOI/ISBN. |
| **bookTitle** (container) | **Enrichment** | → deterministic | 0.03 | 0.99 / — | BIO 0.03. Container title of a chapter is canonical metadata; look it up, don't tag it. |
| **conferenceTitle** | **Enrichment** | → deterministic | 0.28 | 0.99 / — | Same as bookTitle — proceedings name is lookup-shaped. |
| **edition / placeOfPublication** | Enrichment | → deterministic | n/a | — | Canonical bibliographic metadata. |
| **thesisType / institution / repository / siteName** | Deterministic | → BIO | n/a | high / — | Closed-vocabulary or template-anchored; regex + small lookup wins. |

### Why "heuristic clean is 0.99 but BIO owns it anyway" (author/title/journal)

The clean-corpus heuristic F1 is high because clean inputs have unambiguous delimiters. **Production input is
noisy PDF paste**, where the heuristic author score collapses to 0.55. The ownership decision is made on the
**noisy** column and on structural fit, not on the clean number — that is the whole point of the noise-cliff
work in Step 2 and of routing these three fields to BIO once it is data-ready.

---

## Tiered execution model (where throughput comes from)

Owners map to runtime tiers. This is the design the Phase 4 refactor implements.

```
                 ┌─────────────────────────────────────────────────────────────┐
 raw ref ──▶      │  Tier 1 — DETERMINISTIC FAST PATH (always, every ref)        │
                 │  shared CitationFeatures one-pass:                            │
                 │  doi, url, isbn, issn, pmid, arxiv, year, volume, issue,      │
                 │  pages, patent/handle  + cheap author/title/journal split     │
                 └───────────────┬─────────────────────────────────────────────┘
                                 │ residual = refs whose free-text spans are
                                 │ ambiguous / low-confidence after Tier 1
                                 ▼
                 ┌─────────────────────────────────────────────────────────────┐
                 │  Tier 2 — BIO ON RESIDUAL (only when needed, gated)          │
                 │  author / title / journal segmentation for the hard refs     │
                 └───────────────┬─────────────────────────────────────────────┘
                                 │ identifier present?
                                 ▼
                 ┌─────────────────────────────────────────────────────────────┐
                 │  Tier 3 — ENRICHMENT (optional, keyed on Tier-1 identifier)  │
                 │  publisher, bookTitle, conferenceTitle, canonical author list │
                 │  governed by the ≥0.85 overwrite gate                         │
                 └─────────────────────────────────────────────────────────────┘
```

**Throughput consequence — the key tradeoff:**

- The current ~265–275 refs/sec fast lane hits its number **because ML is off**. Running BIO inference on
  *every* reference on CPU will not hold 350 refs/sec.
- Tier 2 is therefore **BIO-on-residual**: clean refs (clear delimiters, identifiers present, high Tier-1
  confidence) **skip BIO entirely** and stay at deterministic speed. BIO cost is paid only on the hard residual.
- The net perf win is **deleting the redundant per-style regex cascade** that Tier 1 + BIO replace — *not*
  "fewer functions" in the abstract. Adding BIO is a cost; removing the cascade is the offsetting win.

---

## Confidence & abstain policy by owner

| Owner | Confidence basis | Abstain rule |
| --- | --- | --- |
| Deterministic (with checksum: isbn/issn/doi) | High (≥0.95) when format + checksum/resolve valid | Abstain if format matches but checksum fails — do **not** emit an invalid identifier |
| Deterministic (locator grammar: year/vol/issue/pages) | Medium-high; reduced when multiple candidates collide | Defer to Tier-2 BIO tiebreak on collision rather than guessing |
| BIO | Span softmax confidence per entity; calibrated, not raw logit | Abstain (emit `needs_action`, no value) below the per-field floor rather than emit a low-confidence span |
| Enrichment | Provider confidence; only overwrites when ≥0.85 **and** > existing | Never overwrites `admin_confirmed`; additive-only below 0.85 |

No silent low-confidence fills. An abstaining field becomes a health signal (`needs_review` / `needs_action`),
consistent with the engine's transparency promise — **not** a silently-empty or silently-guessed value.

---

## Implications for the gold dataset / BIO work (message to the other track)

1. **Label hard:** author, title, journal/venue span boundaries — especially on **noisy** references. This is
   where labels move end-to-end quality. Author boundary on messy multi-author refs is the single highest-value
   labeling target.
2. **Do not optimize BIO for:** url, doi, isbn, issn, year, volume, issue, pages, publisher, bookTitle,
   conferenceTitle. These are owned by deterministic resolvers or enrichment. Labeling them for BIO is wasted
   budget and, worse, lets BIO "win" a field it will be unreliable on in production.
3. **Real before promotion:** the current model is 100% synthetic bootstrap. Per the ML priority plan, BIO does
   not become a primary producer for *any* field until the evidence bundle shows it beats the deterministic
   owner on a **real** holdout, field-by-field — likely author/title/journal first, never the identifier fields.

---

## What is locked vs open

**Locked (do not violate):**
- Deterministic owns all identifiers + structured locators. BIO never produces an identifier. *(First slice
  live: `resolveDoi` is wired behind `DeterministicResolver`; the rest of the identifier resolvers are
  follow-on, parity-locked migrations.)*
- BIO does not become a primary producer without the real-data evidence gate (per ML priority plan).
- Enrichment overwrite stays ≥0.85-gated and never touches `admin_confirmed`.
- ISBN coverage holds the 0.90 floor.

**Open (decide with Step 0 fresh numbers + real BIO data):**
- The exact Tier-1→Tier-2 residual trigger (which confidence/ambiguity conditions route a ref to BIO).
- Per-field BIO confidence floors for abstain.
- Whether journal/venue is BIO-primary or enrichment-primary when a DOI is present (lookup may simply win).
