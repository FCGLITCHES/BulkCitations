# Phase 5.8: Structural Family Router

One-line purpose: bias each carrier toward a reference **type-family** using regex structural cues, field/candidate evidence, and DOI authority hints — *before* type classification runs — so P6 can accept a high-confidence route instead of guessing.

## Pipeline position

P5.8 runs after P5 AuthorDisambig and before P6 TypeClassify. It is an extension stage: it does not set the final `carrier.type`; it writes a routing recommendation that P6 may promote. In the DOI fast path, the router and type classifier are the only two core stages run (`runDoiCorePipeline`).

## Source

- `server/src/engine/phases/phase5_8StructuralFamilyRouter.ts`
- `server/src/engine/utils/type-classification.ts` (`classifyTypeHeuristically`, `fallbackTypeConfidence`)
- `server/src/engine/data/authorityPack.ts` (`lookupAuthorityDoiHints`)
- `server/src/engine/utils/articleContainer.ts` (`recoverArticleContainerSpill`)

## Inputs (read)

- `carrier.structuralRouting` — if already set by an upstream trusted source (`approved_truth` or `authority_pack`, e.g. from the DOI fast path), it is returned unchanged (idempotent).
- `carrier.fields.*` — DOI, year, journal, conferenceTitle, bookTitle, publisher, institution, siteName, title, pages, volume, issue, ISSN, ISBN, URL, repository, arXiv, patent, thesisType, reportNumber, accessedDate, PMID.
- `carrier.candidateEnvelope?.*Candidates` — journal/conference/bookTitle/publisher/institution candidate text used as a fallback when the committed field is empty.
- `carrier.raw` — for cue regexes (conference, preprint, thesis, report, webpage) and the placeholder-DOI-tail check.
- `carrier.doiFastPath` — to emit a DOI-only partial route.

## Outputs (written)

- `carrier.structuralRouting`: `{ type, confidence, source, reasonCodes }` (`StructuralFamilyRoutingResult`). `source` ∈ `heuristic` | `authority_pack` | `approved_truth`. Set via `carrier.structuralRouting ??= routeStructuralFamily(carrier)` (never overwrites an existing trusted route).
- Per-carrier + phase stage records (status `warning` when `type === 'unknown'`).

## Main behavior

`routeStructuralFamily` builds a wide set of boolean profiles from fields/candidates/raw, then commits the **first** matching rule in priority order:

1. `patent` (patent field present) → 0.99
2. `thesis` (thesisType or thesis cue) → 0.98
3. `preprint` (repository/arXiv/preprint cue, or a sparse known-preprint-owner profile with a placeholder DOI tail) → 0.95–0.96
4. `article-journal` — `strongArticleProfile`: journal + strong locators (vol/issue/ISSN) or an article-container word; conference container overridden to article when it carries strong locators; book-container article spill recovered via `recoverArticleContainerSpill` → 0.95–0.97
5. `book-chapter` — bookish-conference override (bookTitle + ISBN/bookish-publisher/bookish-DOI, no conference) → 0.94
6. `conference-paper` — conference cue or an "eventish" named conference container → 0.93–0.94
7. `webpage` — meaningful (non-doi.org) URL, no scholarly locators, plus a web cue/siteName/accessedDate/bare-title → 0.91
8. `book-chapter` (general bookTitle/ISBN-chapter profile) → 0.88
9. `book` (ISBN or bookish publisher without locators) → 0.88
10. `report` — explicit report cue or institutional owner, gated off when article/conference/web/bookish → 0.87–0.93
11. **authority-pack DOI hint** (`lookupAuthorityDoiHints` by DOI+year) → its own type/confidence, `source: 'authority_pack'`
12. DOI-fast-path with no evidence beyond the DOI → `unknown` @ 0.45, `['doi_only_partial_parse']`
13. fallback → `classifyTypeHeuristically(carrier)` with `fallbackTypeConfidence` (or `unknown` @ 0.4), `['heuristic_fallback']`

Reason codes record which override fired (e.g. `conference_container_article_override`, `candidate_envelope_conference_support`, `bookish_conference_override`).

## Parse-profile gating

This stage has **no ML and no execution-policy gate** — it is pure deterministic routing and runs in every profile that reaches the core type stages (both `core_parse_fast` and `core_parse_full`/`current_runtime`, and the DOI fast path). Its inputs differ by profile only insofar as upstream phases populate fewer fields/candidates under the fast lane. Whether the route is *accepted* is decided downstream by P6 (`shouldPromoteStructuralRoute`), which applies per-type confidence floors and trusts `approved_truth`/`authority_pack` sources more readily.

## Notable specifics

- **Trusted-source idempotency**: an `approved_truth` or `authority_pack` route (typically seeded by the DOI fast path in the orchestrator) is returned as-is and never re-derived.
- **Candidate-envelope fallback**: when a committed field is empty, the top-scoring candidate text is used for cue matching, so conference/report routing can fire on extractor candidates that didn't win a field slot.
- **Cue normalization** folds diacritics (NFKD + strip marks) before matching, mirroring P3 so OCR/copy-paste accent corruption doesn't hide "Proceedings"/"Press"/"report" cues.
- **Why it matters**: a misroute here resurfaces downstream as wrong-type field loss — `conferenceTitle`, `bookTitle`, `publisher`, `institution` are the fields most often dropped when the family is wrong.
