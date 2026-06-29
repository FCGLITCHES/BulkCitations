# Phase 6.8: Shared Repair

> Provider-free, cross-field structural cleanup. Moves spilled container metadata into the right slot (journal/volume/issue/issn), strips identifier tails out of titles, and records suppression candidates. Applies a safe subset of repairs in place and shadows the rest for diagnostics.

- **Source:** `server/src/engine/phases/phase6_8SharedRepair.ts`
- **Stage id:** `phase6_8_shared_repair` · **phaseId:** `shared_repair` · contract v1
- **Pipeline position:** after P6 TypeClassify / P6.5 LLMFallback, before P7 Normalize. In the batched fast lane it runs **inline** inside the core batch (its stats are folded into `integratedStageStats`); otherwise the orchestrator runs it standalone via `phase6_8SharedRepair.run`.

## Inputs / Outputs

- **In:** `ReferenceCarrier[]` — typed carriers with extracted fields.
- **Writes (carrier):**
  - `carrier.fields.{journal,volume,issue,issn}` — applied "primary repairs" for `article-journal` carriers, with `source: 'shared_repair'`, confidence floored (journal/issn ≥ 0.9, volume/issue ≥ 0.88), and `previousValue/previousSource/previousOrigin` retained. The drained source field (`conferenceTitle`, `publisher`, or `bookTitle`) is cleared to an empty field.
  - `carrier.candidateEnvelope` — (re)synthesized before and after repair.
  - `carrier.sharedRepairShadow` — `{ proposedMoves, proposedSuppressions }`, the full set of candidates (including ones not auto-applied).
  - `carrier.stageLog` — per-carrier record **only when diagnostics are on** (`debugMode !== 'off'`).
- **Returns:** `{ carriers, stats }` where `stats = { proposedMoveCount, durationMs }`. `apply()` pushes a `ctx.stageLog` summary unless `suppressContextStageLog` is set (the inline lane suppresses it and re-emits a merged summary).

## Behavior

**Proposed moves** (`buildProposedMoves`) — candidates recorded on the ledger; a subset is applied:

- `conference_container_journal_repair` — `conferenceTitle → journal` when an `article-journal` has no journal, strong article locators (volume/issue/issn), the value is not conference-cued, and it is ISSN-typed or matches a journal cue / known-ISSN title.
- `publisher_to_journal_repair` — `publisher → journal` for an `article-journal` with no journal, strong locators, no conference profile, and a publisher value that is not press/publisher-like.
- `book_container_journal_repair` (+ `..._volume_/_issue_/_issn_repair`) — when `bookTitle` parses as an article container (`recoverArticleContainerSpill`) with article support (locators, pages, doi, or an ISSN hint). Splits the spilled journal title and any embedded volume/issue/ISSN out of `bookTitle`; `bookTitle` is cleared after the move.
- `title_tail_identifier_repair` — detects a trailing `http(s)://…` or `doi: 10.…` glued onto the title and proposes moving the tail to `url`/`doi`. **Shadow only** — recorded on the ledger but not auto-applied here.

**Applied primary repairs** (`applyPrimaryRepairs`) — only the container→field moves above are committed, and only for `article-journal` carriers, only into empty destinations, only from a non-empty string source. `title_tail_identifier_repair` is deliberately excluded from application.

**Proposed suppressions** (`buildProposedSuppressions`) — recorded, never auto-applied:
- `duplicate_publisher_container` — `article-journal` whose `publisher` equals its `journal`.
- `web_spill_conference_title` — `webpage` whose `conferenceTitle` equals its `siteName`.

## Parse-profile gating

The stage itself always runs on the non-DOI path (it is not behind a parse-profile toggle). What the parse profile controls is the **diagnostic detail**: per-carrier `stageLog` entries and `candidateEnvelope` capture happen only when `executionPolicy.debugMode !== 'off'`. `core_parse_fast` and `pro_overlay_enrich` set `debugMode: 'off'`, so the repairs still apply but no per-carrier diagnostics are written.

## Notable specifics

- Cross-field "moves" are conservative: applied repairs require the article-journal type and an empty destination, so they fill gaps rather than overwrite existing data. Identifier-tail extraction and all suppressions remain shadow-only — surfaced for review, not mutated.
- Benchmark reports track this stage's repair precision directly; low precision here is a quality signal, not just an implementation detail.
- The `conference_container_journal_repair` / `publisher_to_journal_repair` apply path writes `journal` directly via `fieldOf` (bypassing the proposed `nextValue`, using the trimmed source value); the book-container repairs go through `applyStringRepairField`.
