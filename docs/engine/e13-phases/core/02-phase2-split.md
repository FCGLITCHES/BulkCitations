# Phase 2: Split

One-line purpose: turn the ingest envelope into an ordered array of discrete `RawBlock` citation blocks, with a count audit, split-quality flag, and (optional) PDF-cleanup decision.

## Source

- `server/src/engine/phases/phase2Split.ts` (orchestration, PDF-cleanup evaluation, split-quality scoring, block materialization helpers)
- `server/src/engine/ingestion/split.ts` (`splitPhase2Heuristic` — the format-aware block aggregator the phase delegates to)
- `server/src/engine/ingestion/wrappedTokens.ts` (`joinWrappedDoiLines`, `joinWrappedUrlLines`)

## Position in Pipeline

Second module, for every non-`doi_list` text source. `runConvertPipeline` calls `phase2Split.run(envelope)`; its `blocks` feed `runNonDoiPipelineFromBlocks` → the batched core pipeline (Phase 3 style detect onward). The `doi_list` source skips Phase 2 entirely and goes through the DOI fast path. `pdf` / `docx` uploads are not split here (they carry zero estimated blocks and route to ML extraction).

## Inputs

- `BatchEnvelope` from Phase 1 (reads `rawText`, `detectedFormat`, `formatConfidence`, `structure`, `estimatedCount`, `sourceType`, `detection.sampled`, and `cleanupMeta`).
- `PipelineContext`: reads `ctx.options.enablePdfCleanup`, `ctx.options.pdfCleanupMode`, `ctx.options.enableScoredDetection`; writes stage records.

## Outputs (`Phase2SplitResult`)

- `blocks: RawBlock[]` — each with `index`, `text`, `formatMeta` (source/structure/detectedFormat/confidence), `splitMethod`, `splitConfidence`, `flags` (`too_short` | `too_long` | `uncertain`), `splitReason`, `blockFormat`, and (when cleanup ran) an `inputCleanup` record.
- `countAudit` — `inputEstimate`, `aggregatedCount`, `splitCount`, `delta`, `needsActionCount` (blocks with flags), `droppedCount`.
- `splitQualityFlag` — `ok` | `low` | `sampled`.
- `resolvedEnvelope` — the envelope actually used (baseline, or the cleaned candidate if selected).
- `cleanup` — full audit of the baseline-vs-cleaned comparison (modes, detected formats, quality scores, delta, `wouldSelect`, `finalUsed`, `decisionReason`).

## Main Behavior

1. **Baseline split** (`evaluateSplitCandidate` → `splitPhase2Heuristic`): prepares working text (joins DOI/URL lines wrapped across line breaks), then aggregates blocks by `detectedFormat`:
   - `doi_list` → one block per non-empty line
   - `bibtex` → split on `@type{` entry starts
   - `ris` → split on `TY  -` / `ER  -` boundaries
   - `numbered_list` → split on leading enumerators (`[n]`, `n.`, `n)`)
   - `blank_line` → split on blank-line gaps
   - `hanging_indent` → split on indent structure with a "looks like a citation start" boundary test
   - `plain_text` / `unknown` → hybrid fallback that scores blank-line / numbered / hanging-indent candidates and keeps the best
   A strong numbered structure can override a non-structured `detectedFormat`.
2. **PDF-cleanup evaluation** (`evaluatePdfCleanup`): if cleanup is enabled and the envelope `lookedLikePdfCopy`, it resolves a cleaned candidate (reusing `cleanupMeta.candidateText` or regenerating via `cleanupPdfArtifacts`), re-profiles and re-splits it, then compares against the baseline (see next section). Otherwise it short-circuits to baseline with a `decisionReason` (`not_pdf_like`, `equal_or_noise`, `cleanup_error`).
3. **Materialize**: blocks are tagged with a `splitMethod` derived from the format and a confidence for that method; `too_short` (< 20 chars), `too_long` (> 1,200 chars), and `uncertain` (low-confidence / fallback) flags are attached. Flagged blocks count toward `needsActionCount`.
4. **Count audit + drift warning**: the `splitting` stage record is logged as a `warning` (code `SPLIT_COUNT_AUDIT_DRIFT`) when `|delta| / inputEstimate > 5%` or any block carries a flag; otherwise `success`. Zero blocks throws `SPLIT_NO_BLOCKS_FOUND` (422).

## PDF Cleanup Decision (baseline vs. cleaned)

The cleaned candidate is only *selected* when it measurably wins. Decision logic:

- Compute `qualityDelta = cleanedSplitQuality - baselineSplitQuality` (via `scoreSplitQuality`), a block-count divergence ratio, and whether the cleaned estimate is closer to the input estimate.
- Reject with `block_count_divergence` if block count diverges beyond `PDF_CLEANUP_BLOCK_COUNT_DIVERGENCE_RATIO` (0.2) without improving the estimate.
- Reject with `format_change_without_quality_gain` if the detected format changed but quality did not improve past `PDF_CLEANUP_MIN_IMPROVEMENT_DELTA` (0.01).
- Select (`quality_improved`) only if `qualityDelta > PDF_CLEANUP_MIN_IMPROVEMENT_DELTA`.
- `finalUsed = 'cleaned'` requires `mode === 'full'` AND `wouldSelect === 'cleaned'`. In `inspect_only` mode the comparison is recorded but the baseline is always kept.

`scoreSplitQuality` scores a single complete-looking citation block at 0.92, so a clean single reference produces a high baseline that cleanup cannot beat — cleanup is effectively a no-op for single, well-formed input even when enabled.

## Parse-Profile Gating

Phase 2 runs the same across `core_parse_fast` and `core_parse_full` — it is not ML-gated and reads no `executionPolicy` flag. Its only conditional behavior is the PDF-cleanup branch, gated by request options:

- `enablePdfCleanup` (`env.FEATURE_PDF_CLEANUP`, default true at the convert route; default option `false`) and `pdfCleanupMode` (`off` | `inspect_only` | `full`; routes pass `full`). When `off`, no cleanup evaluation, no `pdf_cleanup_evaluation` stage record, and no `inputCleanup` on blocks.
- `enableScoredDetection` is forwarded when re-profiling the cleaned candidate so its detector matches the baseline's.

## Notable Specifics

- This phase is the **count-parity boundary**: its `splitCount` is what the inspect/convert count audit reconciles against the Phase 1 `inputEstimate`, and drift surfaces as a warning rather than a hard failure.
- Block boundaries set here determine every downstream field/type/render result, so changes have a wide regression blast radius.
- Thresholds: `MIN_BLOCK_LENGTH` = 20, `MAX_BLOCK_LENGTH` = 1,200, `SPLIT_QUALITY_THRESHOLD` = 0.60 (>= → `ok`, else `low`; `sampled` overrides when detection was sampled).
- `splitQualityFlag` (and the split confidence) flow into the carrier's `detection` / `scoring` seed when blocks are turned into carriers in Phase 3.
