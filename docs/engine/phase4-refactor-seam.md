# Phase 4 Refactor — Seam & Tiered Execution

Status: **migration in progress, parity-locked** (drafted 2026-06-22; first slice landed 2026-06-25).
Companion to [field-ownership-map.md](field-ownership-map.md). Typed contract:
`server/src/engine/phases/phase4/extractionContract.ts`.

> **Wiring status:** the contract is types-only **except** for the first deterministic slice. `resolveDoi`
> (Tier-1 DOI) is now wired into `phase4Extract.ts` — the seam went from 0 importers to live and the inline
> DOI block was deleted, **parity-locked byte-identical** (0 diffs across the canonical evals). Everything
> else below — the rest of `DeterministicResolver` (pmid/isbn/arxiv/year/locators), `BioSpanProvider`,
> `FieldMerger`, `ResidualPolicy` — is still types-only and changes no behavior.

## Why

`server/src/engine/phases/phase4Extract.ts` is ~25k lines and is both the
biggest quality risk and ~45% of pipeline wall-clock. Three things are tangled
together inside it:

1. **Deterministic extraction** (regex/identifier scans, per-style templates).
2. **ML routing** (`heuristic | shadow | primary`) and the **opaque "selective
   patching"** that adopts a few BIO fields under hardcoded confidence floors.
3. **Cross-field repair / normalization** hand-offs.

This entanglement is what blocks safe iteration: you cannot change the BIO path
without risking the regex path, and the patching policy is not auditable.

The refactor does **not** change behavior. It **moves** the existing logic
behind the interfaces in `extractionContract.ts`, locked to output parity, so
that the BIO model (built in a separate workstream) drops into one typed seam
when its evidence gate passes.

## Target structure (maps 1:1 to the contract file)

| Tier | Owner | Interface | Where it lives today |
| --- | --- | --- | --- |
| 1 | Deterministic | `DeterministicResolver` | `extractCitationFeatures()` in `extractionFeatures.ts` (already the one-pass) + the identifier-assignment blocks in `phase4Extract.ts`. **DOI slice already lifted to `resolveDoi`.** |
| 2 | BIO (ML) | `BioSpanProvider` | the inline ML routing config + `mlClient` calls in `phase4Extract.ts` |
| — | Residual gate | `ResidualPolicy` | currently the `primaryFraction`/`shadowFraction` routing branches |
| — | Merge | `FieldMerger` + `OWNER_PRECEDENCE` | currently the "selective patching" block (the part to make auditable) |
| 3 | Enrichment | (Phase 8) | `phase8Enrich.ts`, governed by the ≥0.85 overwrite gate |

The `FIELD_OWNERSHIP` constant in the contract is the executable form of the
ownership map: identifiers/locators → deterministic, author/title/journal → BIO,
canonical metadata → enrichment.

## Tiered / residual execution (where throughput comes from)

```
raw ref ─▶ Tier 1 DeterministicResolver (always)
                 │  identifiers + locators, checksum-validated
                 ▼
          ResidualPolicy.needsBioResidual?  ──no──▶ deterministic spans kept (fast path)
                 │ yes (ambiguous/low-confidence author/title/journal)
                 ▼
          Tier 2 BioSpanProvider (mode-gated)
                 │
                 ▼
          FieldMerger (OWNER_PRECEDENCE + confidence gates)
                 │  identifier present?
                 ▼
          Tier 3 Enrichment (optional, Phase 8)
```

The current ~265–275 refs/sec fast lane holds its number **because ML is off**.
Running BIO on every reference on CPU will not hold 350. `ResidualPolicy` is the
lever: clean refs skip Tier 2 and stay at deterministic speed; BIO cost is paid
only on the hard residual. The net perf win is **deleting the redundant per-style
regex cascade** that Tier 1 + BIO replace — not "fewer functions" in the abstract.

## Migration sequence (move-only, each step parity-gated)

Each step must keep `field_hash` **and** `contract_hash` stable on the canonical
benchmark and keep the 45 core regressions at 100%. No behavior change until the
BIO evidence gate (separate plan) is met.

1. **Extract `DeterministicResolver`** — lift the identifier/locator assignment
   blocks behind the interface, reading from `extractCitationFeatures`. *(The
   Step 2 ISBN checksum gate is the first concrete strengthening here.)*
   **DONE for DOI:** `resolveDoi(features)` is live and the inline DOI block is
   removed (parity byte-identical). pmid/isbn/arxiv/year/locators are the
   remaining slices in this step.
2. **Extract `FieldMerger`** — replace the inline selective-patching block with
   `merge(produced, policy)` over `OWNER_PRECEDENCE`. Same inputs/outputs;
   now one auditable function with per-field provenance.
3. **Extract `BioSpanProvider`** — wrap the existing `mlClient` extraction call
   behind the interface; keep the current `heuristic|shadow|primary` modes.
   No new model behavior.
4. **Introduce `ResidualPolicy`** — initially returns the *current* routing
   decision verbatim (parity), then becomes the tiered fast-path gate once the
   Step 0 numbers set thresholds.
5. **Split the per-style template code** into field parsers behind
   `DeterministicResolver`, file-by-file, parity-locked.

Steps 1–4 are mechanical and low-risk. Step 5 is the bulk of the line-count
reduction and is done last, incrementally.

## What this unblocks

- **The BIO workstream** gets `BioSpanProvider` / `BioSpanResult` to implement
  against — including the `diagnostics` shape Phase 10 needs to score real
  sequence errors (`overlapping_spans`, `unclosed_bio_sequence`,
  `missing_required_ml_span`).
- **Auditable ML adoption** — `FieldMerger` + `OWNER_PRECEDENCE` replace the
  opaque patching, so promoting BIO field-by-field is a policy change, not a
  code change.
- **Honest throughput** — `ResidualPolicy` makes the speed/quality tradeoff an
  explicit, tunable decision instead of an implicit consequence of ML being off.

## Locked invariants

- Deterministic owns every identifier; BIO never produces one.
- Identifier emission is checksum/format-gated; failures abstain, not guess.
- Enrichment overwrite stays ≥0.85-gated, never touches `admin_confirmed`.
- BIO is not a primary producer for any field until the real-data evidence gate
  passes. Until then `ResidualPolicy`/`BioSpanProvider` run in shadow only.
- Every migration step is parity-locked on `field_hash` + `contract_hash` and
  the 45 core regressions.
