# Phase 1: Ingest

One-line purpose: turn raw request input into a normalized, profiled `BatchEnvelope` (format, structure, count estimate, DOIs, signals) that every downstream phase reads from.

## Source

- `server/src/engine/phases/phase1Ingest.ts` (orchestration, format/structure/count profiling, scored detector, BibTeX/RIS parsers)
- `server/src/engine/ingestion/normalize.ts` (`normalizeIngestionText` — Unicode/whitespace normalization)
- `server/src/engine/ingestion/ocrRepair.ts` (`repairOcrArtifacts` — safe OCR-ligature expansion)
- `server/src/engine/ingestion/ocrFold.ts` (matching-layer OCR folding / DOI recovery — keys only, not output)
- `server/src/engine/ingestion/detect.ts`, `canonical.ts` (signal collection, hashing, sanitization)

## Position in Pipeline

First module. Runs once per request before any branching. `runConvertPipeline` calls `phase1Ingest.run(...)` (or replays a precomputed envelope from the convert preflight to avoid re-normalizing). Its output `BatchEnvelope` feeds:

- the DOI fast path (`doi_list` source) directly, or
- Phase 2 split (all other text sources), or
- a deferred ML-extraction marker (`pdf` / `docx` uploads).

## Inputs

- `InspectRequest`: `sourceType` (`text` | `txt` | `doi_list` | `bib` | `ris` | `pdf` | `docx`) and raw `content` string.
- `PipelineContext`: reads `ctx.options.enableScoredDetection`, `ctx.options.enablePdfCleanup`, `ctx.options.pdfCleanupMode`; writes stage records to `ctx.stageLog`.

## Outputs (`BatchEnvelope` fields)

- `sourceType`, `provenanceKey`, `pipelineMajor: 3`
- `detectedFormat` — `doi_list` | `bibtex` | `ris` | `numbered_list` | `blank_line` | `hanging_indent` | `plain_text` | `unknown`
- `structure` — `structured` | `semi_structured` | `unstructured` | `unknown`
- `formatConfidence` (heuristic, per-format constant) and, when the scored detector is on, `detection` (chosen/second-best/confidence/method/sampled)
- `estimatedCount` — used by the route to decide sync vs. queued execution and to seed the count audit
- `detectedDois` (deduped unless source/format is a DOI list, where duplicates are preserved for index parity), `hasDois`
- `styleHints` (cheap pre-style nudges, e.g. `apa7`, `ieee`/`vancouver`, `mla9`)
- `ingestionSignals`, `normalizationMeta`, `normalizedHash` (canonical hash of normalized text)
- `rawText` (normalized) and `rawTextOriginal`
- `cleanupMeta` (only when PDF cleanup mode is not `off`) — `lookedLikePdfCopy`, cleanup `hints`, and an optional `candidateText`

## Main Behavior

1. **Normalize** (`normalizeIngestionText`): NFC then NFKC pass, strip leading BOM, normalize CRLF/CR to `\n`, sanitize via `sanitizeInputTextForPipeline`, expand tabs to 4 spaces, strip NBSP / zero-width / control / replacement chars. Produces `physicalLines`, `logicalLines`, and a `normalizationMeta` record of every transform that fired. A normalization stage record is logged with the normalized hash and provenance key.
2. **Branch by source type:**
   - `pdf` / `docx`: build a file-upload envelope flagged for ML extraction (`structure: 'unknown'`, `estimatedCount: 0`, `isPdfExtracted` / `isDocxExtracted` set) and return early — no text profiling.
   - Empty input or input over `MAX_INPUT_CHARS` (500,000) throws `INGEST_EMPTY_INPUT` / `INGEST_FILE_TOO_LARGE`.
   - Unsupported source types throw `INPUT_VALIDATION_FAILED`.
3. **Profile the text** (`buildProfiledTextEnvelope`): always builds a legacy heuristic envelope (regex-based format detection, count estimate, structure, DOI extraction, style hints). When the scored detector is enabled (`ctx.options.enableScoredDetection`, else `env.FEATURE_SCORED_DETECTOR`, default off), it additionally runs per-format scorers (`scoreRisFormat`, `scoreBibtexFormat`, `scoreDoiListFormat`, `scoreNumberedFormat`, `scoreHangingIndentFormat`, `scorePlainTextFormat`), picks the top by margin, derives a sigmoid confidence (with a sampled discount), and overlays that result onto the envelope. A detection-telemetry stage record compares legacy vs. scored format/structure/count.
4. **Count estimation** is format-specific: entry-marker counts for BibTeX/RIS/numbered, blank-line block counts, hanging-indent block counts, DOI-line counts, or a year-anchor heuristic for plain text (always clamped to >= 1).
5. **Log** a profiling stage record with the detected format, structure, estimate, DOI count, scored confidence, and any cleanup signals.

## OCR / PDF Cleanup (quality-gated)

- **Always-on, safe surface repair:** `repairOcrArtifacts` expands typographic ligatures (ﬁ→fi, ﬂ→fl, ﬀ, ﬃ, ﬄ, ﬅ, ﬆ) only. No alphabetic OCR un-mangling (rn→m, cl→d, …) is done on output text — those rules corrupt real words and are confined to the matching layer.
- **Extraction-layer de-hyphenation:** `fixEndOfLineHyphens` rejoins words broken across a line by a trailing hyphen (`govern-\nment` → `government`). It runs as part of `cleanupPdfArtifacts`, not as a blanket mutation of all input.
- **Matching-only OCR folding** (`ocrFold.ts`): `ocrFoldKey` builds lossy comparison keys (collapsing confusables m/rn, 0/o, 1/l/i, …) and `recoverDoi` reconstructs a DOI's grammar-guaranteed prefix/registrant while keeping the suffix verbatim. These produce lookup candidates only and **never** mutate displayed text; callers (enrichment) must verify before trusting.
- **`cleanupPdfArtifacts`** (OCR ligature repair → EOL de-hyphenation → soft-line-break merge → PDF-artifact stripping) is the heavier reflow path. Phase 1 only *generates* a cleanup candidate into `cleanupMeta` when `looksLikePdfCopy(rawText)` trips (>= 2 of: many short lines, multiple hyphen breaks, standalone page-number/artifact lines, bullet-glyph lines). It does **not** apply it here; Phase 2 owns the accept/reject decision. The candidate is suppressed if it exceeds `PDF_CLEANUP_MAX_CANDIDATE_LENGTH`.
- Cleanup metadata is only produced when `ctx.options.enablePdfCleanup` is set and `pdfCleanupMode !== 'off'`. A clean single reference does not trip `looksLikePdfCopy`, so cleanup is effectively a no-op for single-ref input.

## Parse-Profile Gating

Phase 1 runs identically across parse profiles — it is not gated by `core_parse_fast` vs `core_parse_full`. Its behavior varies only by request-level options:

- `enableScoredDetection` / `env.FEATURE_SCORED_DETECTOR` — turns on the scored detector overlay (default off; legacy heuristic otherwise).
- `enablePdfCleanup` (`env.FEATURE_PDF_CLEANUP`, default true at the convert route) + `pdfCleanupMode` (routes pass `'full'`; default option is `'off'`) — controls whether `cleanupMeta` / candidate text is generated.

## Notable Specifics

- `doi_list` source preserves duplicate DOIs (index parity for the fast path); all other extraction dedupes via a normalized DOI key with trailing punctuation stripped.
- The convert route runs Phase 1 twice conceptually but only once in practice: a preflight `phase1Ingest.run` produces the count estimate used for quota/sync-vs-queue decisions, and that envelope + stage log is replayed into the real pipeline as `precomputedIngest`.
- BibTeX and RIS field parsers (`parseBibtexEntries`, `parseRisEntries`) live here and are exported for downstream structured handling.
- `MAX_INPUT_CHARS` = 500,000; tab width = 4.
