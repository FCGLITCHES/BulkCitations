# Phase 7: Normalize

> Canonicalizes extracted values into the engine's stable field contract — DOI/URL/pages/edition/title/author/year cleanup — then recalibrates field confidence to the validated Phase 10 gates and re-audits mandatory-field coverage.

- **Source:** `server/src/engine/phases/phase7Normalize.ts`
- **Stage id:** `phase7_normalization` · **phaseId:** `normalization` · contract v1
- **Pipeline position:** after P6.8 SharedRepair / P6.5 LLMFallback, before P8 Enrich. In the batched fast lane it runs **inline** inside the core batch (folded into `integratedStageStats`); otherwise the orchestrator runs it standalone via `phase7Normalize.run`.

## Inputs / Outputs

- **In:** `ReferenceCarrier[]` — repaired carriers.
- **Writes (carrier):**
  - `carrier.fields.{doi,url,pages,edition,title,authors,year}` — rewritten in place via `rewriteField` when normalization changes the value; `source: 'normalization'`, origin stage `phase7_normalization`, confidence raised to a per-field floor (`max(existing, floor)`): doi/url/pages/edition 0.85, title 0.84, authors 0.84, year 0.9.
  - `carrier.normalizationMeta` — `{ appliedRules, mandatoryFieldCheck }`. `appliedRules` is a `{ field, before, after, rule }[]` mutation log; it is seeded from any pre-existing `normalizationMeta.appliedRules` and appended to.
  - field confidences across the carrier — adjusted by two calibration passes (below).
  - `carrier.stageLog` — per-carrier record **only when** `debugMode !== 'off'`.
- **Returns:** `{ carriers, stats }` with `stats = { carrierWarnings, durationMs }` (`carrierWarnings` counts carriers still missing mandatory fields). Pushes a `ctx.stageLog` summary unless `suppressContextStageLog` is set.

## Normalization rules

- **DOI** (`normalizeDoi`): strips `https?://(dx.)?doi.org/` and `doi:` prefixes, trims, lowercases.
- **URL** (`normalizeUrl`): repairs split schemes (`http: //` → `http://`), removes all whitespace, trims trailing `.`/`)`.
- **Pages** (`normalizePages`): strips `pp.`/`pages` labels, converts en/em dashes to ASCII `-`, collapses spaces and repeated hyphens, and **expands abbreviated ranges** (`123-7` → `123-127`). See "Pages canonical form" below.
- **Edition** (`normalizeEdition`): `2nd` → `2nd ed.`, `second` → `2nd ed.`, `third` → `3rd ed.`.
- **Title** (`normalizeTitleText`): trims and collapses internal whitespace.
- **Authors** (`normalizeAuthors`): trims `family`/`given`/`initials`/`literal`, then drops entries failing `isValidCanonicalAuthor`.
- **Year** (`normalizeYear`): extracts the first 19xx/20xx and stores it as a `number`.

Each rule no-ops (no rewrite, no rule entry) when the normalized value equals the original.

## Confidence recalibration

After the field rules, two passes run per carrier:
1. `calibrateStructurallyValidFieldConfidences(carrier.fields)` — for non-trusted-origin fields whose value is structurally valid, lifts confidence up to the **validated** mandatory threshold (`FIELD_CONFIDENCE_THRESHOLDS_VALIDATED`) so Phase 10 gates don't reject correct values.
2. `syncFieldUncertainty(carrier.fields)` — re-derives the `uncertain` flags from the new confidences.

It then runs `auditMandatoryFields` for the carrier's type and the effective output style (requested style if concrete, else the carrier's resolved effective style), recording the result in `normalizationMeta.mandatoryFieldCheck` and incrementing `carrierWarnings` when mandatory fields are missing.

## Pages canonical form (recent change)

`normalizePages` stores the **canonical DATA form: an ASCII hyphen with full page numbers**. The en-dash (and Vancouver-style page abbreviation) is a per-style **presentation** concern applied later at render — not stored on the field. Storing the en-dash here previously made the field mismatch the hyphenated gold on every page range. This function is a mirror of `normalizePages` in `phase4Extract.ts`, so extraction and normalization agree on the stored form.

## Parse-profile gating

The stage always runs on the non-DOI path. The parse profile only gates **diagnostic detail**: per-carrier `stageLog` entries are written only when `executionPolicy.debugMode !== 'off'` (`core_parse_fast` and `pro_overlay_enrich` set `debugMode: 'off'`, so normalization still applies but emits no per-carrier records). The normalization rules and recalibration are not toggled by parse profile.

## Notable specifics

- Shared infrastructure: every downstream phase (enrich, health, authority, render) consumes these normalized fields, so changes here must be validated broadly.
- All rewrites preserve provenance through `rewriteField` (previous value/source/origin retained) and only ever raise confidence to a floor, never lower it.
- The mandatory-field audit here is advisory (it sets warnings/metadata); it does not drop or block references.
