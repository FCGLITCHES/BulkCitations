# Phase 5: Author Disambiguation

One-line purpose: stabilize the `authors` field after extraction — re-parse the author span when the extracted list is missing, contaminated, or under-split; optionally refine it with ML author-NER; and promote the best author list across carriers that share an identifier.

## Pipeline position

P5 runs after P4 Extract and before P5.8 StructuralFamilyRouter. It operates on the carriers extraction produced, mutating `carrier.fields.authors` in place.

## Source

- `server/src/engine/phases/phase5AuthorDisambig.ts` (the stage)
- `server/src/engine/utils/authors.ts` (`parseAuthorSegment`, `isLikelyAuthorSegment`, `isValidAuthorSpanText`, `toCanonicalAuthor`, corporate/organization detection)

## Inputs (read)

- `carrier.raw` — to slice the author segment (everything before the first year, leading enumerator stripped, trimmed back before the title/quote).
- `carrier.fields.authors` and `carrier.healthEvidence.validSpanFields` — to decide whether an existing list is already trusted.
- `carrier.fields.title / publisher / journal / conferenceTitle / bookTitle / institution` — for contamination checks and the institutional-owner-report guard.
- `ctx.executionPolicy.authorDisambiguationMl` (`off` vs `routed`), `ctx.runtimeTuning.batchSize`, and the phase budget.

## Outputs (written)

- `carrier.fields.authors` — replaced with a new `{ value, source, confidence, origin }` field when a better parse wins. `source` is `ml_author_ner` or `regex_fallback`; confidence floors at `FIELD_CONFIDENCE_THRESHOLDS.authors` (~0.75) for valid spans.
- `carrier.healthEvidence.validSpanFields` — `'authors'` added when the new list validly covers the span.
- `carrier.authorListIncomplete` — set `true` when `et al.` is detected in the author zone (surfaced by health as the `author_list_incomplete` info warning; **does not** lower confidence).
- Field-uncertainty re-synced via `syncFieldUncertainty`; per-carrier + phase stage records.

## Main behavior

For each carrier:

1. **Institutional-owner-report guard**: if the raw text is a repeated "Owner. Title. Owner" institutional report with no article/book locators, authors are deliberately cleared (an org owner is not an author).
2. **Author-segment extraction**: slice before the year, strip a leading `[n]`/`n.`/`(n)` enumerator, then `trimAuthorSegmentBeforeTitle` trims at the first long quoted span, at the title hint, and drops a leading sentence-author span when the remainder looks like title text.
3. **Preserve trusted lists**: if the existing `authors` is already a validated span and not contaminated and the fresh re-parse isn't strictly better, keep it (no-op success).
4. **Decide the parse**: compute `fallbackAuthors = parseAuthorSegment(...)`. `shouldPreferFallbackAuthorReparse` prefers the re-parse when the existing list is empty/contaminated, or the re-parse yields **more** authors the segment can support, or has materially richer detail. `shouldReplaceAuthorList` is the final gate before overwriting.
5. **ML path (routed only)**: `shouldAttemptMlAuthorDisambiguation` decides which carriers are worth an ML call (likely-author segment that is missing/contaminated/under-split — e.g. `et al.`, semicolons with ≤2 parsed, comma+initials patterns). Eligible carriers are batched (`batchSize`) through `mlClient.authorNer`. The ML result wins only if it validly covers the span and `shouldPreferFallbackOverMlAuthors` doesn't flag it (more fallback authors, equal-count-richer fallback, or an initials/family swap). Otherwise the regex fallback is applied and a `AUTHOR_ML_UNAVAILABLE` warning is logged.
6. **Cross-carrier identifier promotion** (`promoteBestIdentifierAuthors`, always runs): carriers grouped by normalized DOI/URL/patent/handle/arXiv (scoped by `semanticGroupKey`); the richest author list in a group is promoted onto siblings that are under-populated, so DOI-fast-path / sparse rows inherit a good list. Also re-exported as `reconcileIdentifierAuthorGroups` and invoked by the fast-lane finalizer.

## Parse-profile gating

- `core_parse_fast` → `authorDisambiguationMl: 'off'`: **regex only**. An extracted, uncontaminated list is preserved without a fallback reparse; otherwise the regex parse is applied. No ML call, no `STYLE/AUTHOR_ML_UNAVAILABLE`-style warning from a missing client. `promoteBestIdentifierAuthors` still runs (and the fast-lane finalizer calls `reconcileIdentifierAuthorGroups`).
- `core_parse_full` / `current_runtime` → `authorDisambiguationMl: 'routed'`: ML author-NER is attempted for the subset selected by `shouldAttemptMlAuthorDisambiguation`, within budget; everything else falls back to regex.
- A `routed` policy with **no** ML client wired (or an ML error/budget timeout) degrades to regex fallback and logs the warning.

## Notable specifics

- **Corporate name with a comma now parses as one organization, not multiple persons.** `parseAuthorSegment` returns a single `corporateAuthor(...)` when `looksLikeSingleOrganization` matches `STRONG_ORG_HINTS` (e.g. "World Health Organization, Department of X") — previously the comma split it into bogus people. (Pure `CORPORATE_HINTS` still only collapses when there's no comma.)
- **Cyrillic "Family, Given" parses correctly.** The name-token regexes use Unicode properties (`\p{Lu}`, `\p{L}`) rather than `[A-Z]`, so non-Latin scripts flow through the same `parseSingleAuthor` / standalone-chunk paths.
- **`et al.` is treated as legitimate truncation**: it sets `authorListIncomplete` (info-level health surfacing) but is intentionally *not* a confidence penalty — the stored list is correct, just short.
- Richness comparisons (`authorListRichness`, `hasBetterAuthorDetail`) bias toward fuller given names over bare initials, and require a meaningful detail gain (≥3) before replacing an equal-length list.
