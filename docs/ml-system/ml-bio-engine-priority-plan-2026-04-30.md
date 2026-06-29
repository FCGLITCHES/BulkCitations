# ML/BIO Engine Priority Plan

Date: 2026-04-30

## Scope

This plan is based on a deep local search of the BulkReferences ML system, engine phases, and BIO tagging paths, plus a GPT Pro planning review in the Bulkref ChatGPT project.

The plan is intentionally evidence-first. It does not propose changing live parser behavior until the measurement, data, and regression gates are complete.

## Status update (2026-06-25)

This plan is still the active roadmap; the gate-before-behavior intent below is unchanged and still correct. The notes here record how far execution has progressed against it as of 2026-06-25. Per-item `[STATUS: ...]` tags are inline throughout the document.

Headline progress:

- The evidence/lane and BIO-promotion-truth scaffolding the plan called for largely exists. `server/src/admin/mlBioEvidenceReport.ts` is a substantial implementation with the full lane registry (`EvidenceThroughputLaneId`: direct engine, direct engine + report, backend convert route, queued job runtime, browser submit-to-results, browser first paint, browser all-rendered), an `evidenceBundle` carrying `quality` / `siteSpeed` / `trainingData` / `safeRollout` / `finalVerdict`, and speed-claim invalidation when quality fails or browser timing is missing.
- BIO evaluation (P4) went further than the original plan and is effectively DONE: span->BIO->span round-trip and split-leakage checks exist (`ml-service/datasets/citation-bio/scripts/`), and evaluation now reports entity exact F1, per-label F1, BIO-validity rate, accept-without-edit rate, mean field similarity, and a confident-wrong rate, with a real/synthetic/admin stratum breakdown (`ml-service/tools/eval_bio_model.py`, `ml-service/app/bio_eval_metrics.py`).
- Phase 4 stayed exactly where the plan demanded: default `ML_PHASE4_MODE=heuristic` (ML off in the fast lane), ML/BIO only ever shadow or selective-patch, never the full live primary parser. Attribution-only diagnostics (P6) landed (`ShadowDiff`, `ExtractionBioDebug`, malformed-BIO/overlap diagnostics) without changing live output.

Known progress this plan partly anticipated (now confirmed in code):

- A BIO consensus/projection loop was executed: three independent signals (LLM pre-label, live model, approved truth) vote per span (`server/src/training/bioConsensus.ts`, `bioConsensusTriage.ts`, `bioReviewTriage.ts`). This is the substrate for the P3 "approved-truth-to-BIO" audit, which the plan predicted was needed. Hardened label projection recovered roughly 9% of previously-dropped labels.
- The gold-vs-synthetic A/B is reflected in the data layout: real gold lanes (`real_train_v1.jsonl`, `real_corpus_gold_v1.jsonl`) are kept separate from synthetic, and `ml-service/tools/quarantine_synthetic_bootstrap.py` enforces the "do not use synthetic bootstrap as real promotion proof" rule. Validated gold roughly doubled real-reference accuracy while the prod model remains synthetic-trained and weak on real refs — exactly the risk this plan's "Must Not Change Yet" section guards against.
- Full-batch training hung past ~700 rows; the trainer is now mini-batched specifically to make large sets train without thrashing/timing out (`ml-service/tools/train_bio_bundle.py`, batch loop ~lines 251/265, comment at ~264). This constraint is real and now mitigated rather than fixed away.

Biggest reality divergences corrected below:

- The plan's "Approved-truth-to-BIO export uses substring/token matching and needs an audit layer before its rows can be trusted" line is now only half true. The audit layer is partially built (per-field projection method/score, `projection_status`, `unprojected_fields`, `needs_review`, real/synthetic/admin separation), but it does NOT yet emit the standalone `bio_supervision_audit.json` artifact and does NOT hard-block on silent critical-field loss — so P3 is IN-PROGRESS, not DONE.
- Admin BIO promotion gating (P5) is NOT the four-card "Release Readiness" UI the simplified model envisioned. The backend gate (`evaluateBioPromotionGate`) hard-blocks only on structural validity (valid bundle, is-a-BIO-token-classifier, has training data); holdout-eval / shadow-history / benchmark presence are advisory only, and the rich gate-card UI does not exist. Treat the "Simplified Admin Model" / Admin P0–P4 section as still-aspirational.
- The two non-browser runtime lanes the plan made central (backend convert route, queued job runtime) are declared in the registry but still emit `measured: false` placeholder/`missingReason` stubs in the evidence report, and `admin-throughput-gap.ts` produces its own JSON artifact that the evidence report does not yet consume (P1 integration gap). No real browser-timing producer exists yet (P2), so site-speed remains formally "not measured" rather than measured-and-attached.

## Search Findings

- Engine phases are documented as a staged citation pipeline: ingest, split, style detect, extract, author disambiguation, structural routing, type classify, optional LLM fallback, shared repair, normalize, enrich, dedupe, health, authority, render, and feedback.
- Runtime orchestration batches the core stages in this order: style detection, extraction, author disambiguation, structural family routing, and type classification. Later phases handle repair, normalization, enrichment, dedupe, health, render, and feedback.
- Phase 4 extraction is currently heuristic-first. ML/BIO can run in shadow or guarded primary mode, but primary mode only applies selective grounded patches for a small field set. BIO is not a full live primary parser.
- The Node ML bridge exposes health, style detection, extraction, author NER, and type classification with cached health, circuit breaker, queue depth, and shadow-drop metrics.
- The Python ML service can serve ONNX-backed extraction, style/type classifiers, author parsing, PDF/DOCX ingest, metrics, and runtime admin state. Extraction caps batch size at 128 items and can fall back to heuristic backend when ONNX is unavailable.
- The ONNX/BIO extractor builds token labels, BIO entities, diagnostics, and derived fields. Diagnostics include malformed BIO sequences and overlapping spans.
- BIO dataset docs treat character-span gold as canonical. BIO labels are generated projections, not the source of truth. (Still true. A 3-signal consensus loop — `bioConsensus.ts` — now reconciles LLM, model, and approved-truth spans, with hardened projection recovering ~9% of previously-dropped labels.)
- Approved-truth-to-BIO supervision export currently uses substring/token matching and needs an audit layer before its rows can be trusted for promotion decisions. (Update 2026-06-25: an audit layer is now partially built in `bioSupervisionExport.ts` — per-field method/score, `projection_status`, `unprojected_fields`, `needs_review`, real/synthetic/admin separation — but the standalone `bio_supervision_audit.json` artifact and the silent-critical-field-loss hard block are NOT done. See P3.)
- Admin BIO training can build and promote a bundle, but promoted bundle does not mean BIO is the live full primary parser. (Still true and enforced: default `ML_PHASE4_MODE=heuristic`, ML/BIO shadow or selective-patch only.)
- The ML/BIO evidence report already compares several modes, but backend convert route and queued job runtime lanes are still missing or attach-only, and browser speed must not be inferred from direct-engine speed. (Update 2026-06-25: the lane registry and evidence bundle now exist in `mlBioEvidenceReport.ts`; the backend-convert and queued-job lanes are declared but still emit `measured: false` placeholders, and no browser-timing producer exists yet, so site speed is reported as "not measured". See P0/P1/P2.)

## GPT Pro Corrections Adopted

- Run throughput-lane completion and BIO data/export audit in parallel, with separate gates.
- Do not make BIO metrics or promotion decisions depend on unaudited approved-truth-to-BIO export rows.
- Treat health, action-needed, and duplicate changes as promotion blockers, not late cleanup.
- Keep Phase 4 behavior unchanged until evidence, data, and regression gates are locked.

## Simplified Admin Model

[STATUS: PENDING — aspirational. The backend evidence bundle (`mlBioEvidenceReport.ts`) computes the four card concepts (quality / siteSpeed / trainingData / safeRollout) and a `finalVerdict`, but the unified four-card admin "Release Readiness" screen described here is NOT built. Today's admin BIO surface (`AdminBioTraining.tsx`) shows live/staged bundles and a promote button gated only on structural validity; it has no gate-card dashboard and no plain-language blocked-reason banner.]

GPT Pro's follow-up recommendation is to collapse the admin experience into one concept: Parser Release Readiness.

The admin should not need to understand BIO shadow lanes, queued job runtime, field F1, Phase 4 patch attribution, or split leakage. Those details remain available in an advanced drawer and in the evidence bundle for Codex/developer review.

Default admin view:

1. Parsing Quality - are parsed references still correct?
2. Real Site Speed - how fast is the actual browser experience?
3. Training Data Health - is the model trained on trusted, clean data?
4. Safe Rollout - can this be released without changing live behavior unsafely?

Final verdict:

- Not ready
- Ready for shadow testing
- Ready for limited rollout
- Ready for live promotion

Plain-language blocked reasons should be shown at the top, limited to the top one to three issues. Example: "Real site speed has not been measured" or "Some expected fields could not be safely matched back to the original reference text."

## Simplified Execution Track

[STATUS: PENDING — the Admin P0–P4 delivery grouping (and the `evidenceBundle.json` / four-card UI framing) is not yet shipped as an admin product. The underlying evidence bundle exists in code (Admin P0 substantially backed), but Admin P1 Real Website Speed has no producer, Admin P2 Training Data Health audit is partial (no standalone artifact, no hard block), Admin P3 candidate-vs-current safety is only partly wired, and the Admin P4 Release Readiness UI does not exist. The detailed P0–P9 technical list below is the accurate per-item status.]

The detailed P0-P9 list below remains the technical backing plan. For implementation ticketing and admin communication, collapse it into five delivery groups:

### Admin P0 - Evidence Bundle

Goal:
- Produce one `evidenceBundle.json` as the source of truth for every parser or model evaluation.

Acceptance criteria:
- Bundle contains `quality`, `siteSpeed`, `trainingData`, `safeRollout`, `advanced`, and `finalVerdict`.
- Missing checks are explicit, not silently ignored.
- Quality failure blocks both speed success claims and promotion.
- Effective parser settings, runtime settings, model versions, and corpus hashes are recorded.

Guardrail:
- Measurement and reporting only. Do not change parser behavior, BIO mode, runtime defaults, or live site behavior.

### Admin P1 - Real Website Speed

Goal:
- Measure the actual 500-reference browser path instead of treating direct-engine speed as website speed.

Acceptance criteria:
- Browser artifact records submit-to-results, first result, first paint, all rendered, output count, browser refs/sec, and corpus hash.
- Admin UI labels this as "Real Site Speed".
- Direct-engine speed appears only in advanced details.
- Browser timing cannot attach if corpus hash or reference count does not match the evidence bundle.

Guardrail:
- Do not bypass the frontend, disable rendering, skip normal polling, or alter the parse profile to improve timing.

### Admin P2 - Training Data Health

Goal:
- Prove approved-truth-to-BIO supervision is trustworthy before it can support promotion.

Acceptance criteria:
- Admin sees Training Data Health as Pass, Warning, or Fail.
- Real, synthetic, and admin-approved rows are separated.
- Export audit reports skipped rows, ambiguous rows, not-found fields, duplicate/leakage risks, and critical-field loss.
- Unresolved critical-field loss blocks promotion.

Guardrail:
- Do not silently drop fields. Do not merge synthetic bootstrap scores into real promotion evidence.

### Admin P3 - Candidate Vs Current Safety

Goal:
- Compare the current live parser against any candidate model or parser path in terms an admin can trust.

Acceptance criteria:
- Report shows critical field changes, rendered citation changes, ready/action-needed changes, duplicate changes, and accepted/rejected BIO patch summary.
- Token accuracy alone cannot pass the gate.
- Any unexplained critical-field, readiness, rendered-output, or duplicate regression blocks promotion.
- Candidate BIO remains shadow or offline only.

Guardrail:
- Do not make BIO the full live primary parser. Do not widen BIO patch fields. Do not let Type ML change render/status without separate proof.

### Admin P4 - Release Readiness UI

Goal:
- Build one admin screen powered by the evidence bundle.

Acceptance criteria:
- UI has four cards: Parsing Quality, Real Site Speed, Training Data Health, and Safe Rollout.
- Promote action is disabled unless required gates pass.
- Blocked state shows the top one to three plain-English reasons.
- Advanced drawer exposes raw lane, BIO, field metric, hash, and timing details for developer review.

Guardrail:
- UI must not imply that promoting a BIO bundle means BIO is live as the full parser.

## Priority List

### P0 - Evidence Contract And Lane Truth

[STATUS: DONE (with two lanes still placeholder). `mlBioEvidenceReport.ts` defines the full `EvidenceThroughputLaneId` registry (all 7 lanes), marks each lane measured/missing with a `missingReason`, captures requested+effective parse/runtime profile, Phase 4 mode/fractions, ML flags, BIO bundle version, ML backend/health, decision gates, and invalidates speed claims when quality fails or browser timing is absent. Gap: the backend-convert-route and queued-job-runtime lanes are declared but emit `measured: false` placeholders — they have no measurement path yet.]

Scope:
- `server/src/admin/mlBioEvidenceReport.ts`
- `server/scripts/diagnostics/admin-throughput-gap.ts`
- related admin diagnostics routes and tests

Execution:
1. Add a formal lane registry for direct engine, direct engine plus report generation, backend convert route, queued job runtime, browser submit-to-results, browser first paint, and browser all-rendered.
2. Include requested and effective parse profile, runtime profile, Phase 4 mode and fractions, ML flags, BIO bundle version, ML backend/health, lane status, missing reasons, quality gate, and speed-claim validity in every report.
3. Mark speed claims invalid when quality fails or browser timing is missing.
4. Keep direct-engine throughput clearly labelled as parser-only throughput.

Acceptance metrics:
- Every lane is marked `complete`, `missing`, `failed`, or `attached`.
- Browser/site throughput is only reported from browser timing.
- Quality failure blocks refs/sec from being treated as a valid product-speed claim.

Tests:
- Report schema snapshot.
- Missing browser timing keeps browser speed invalid.
- Forced quality failure keeps speed claim invalid even when refs/sec exists.
- Small sync-route and large queued-route integration tests.

Guardrail:
- Do not change parser behavior, ML routing, BIO mode, runtime defaults, or site behavior.

### P1 - Reusable Throughput Diagnostics Artifact

[STATUS: IN-PROGRESS. `server/scripts/diagnostics/admin-throughput-gap.ts` produces a stable JSON artifact (input/output sha256, corpus metadata, direct + HTTP-route runs, queue wait via `queuedJobAndPollingMs`, poll count, response bytes, stage totals). Gap: the evidence report does NOT import or consume this artifact — `mlBioEvidenceReport.ts` runs its own direct-engine and HTTP measurements, so the "consume instead of duplicating measurement logic" acceptance criterion is unmet.]

Scope:
- `server/scripts/diagnostics/admin-throughput-gap.ts`
- diagnostics tests
- evidence report import/ingest code

Execution:
1. Turn the existing direct engine, HTTP route, queued/polling job, serialization, and stage timing measurements into a stable JSON artifact.
2. Include input hash, output hash, corpus metadata, route overhead, queue wait, job runtime, response bytes, and stage totals.
3. Let the ML/BIO evidence report consume this artifact instead of duplicating measurement logic.

Acceptance metrics:
- Diagnostics artifact contains machine-readable sections for all non-browser lanes.
- Route/job lanes cannot silently borrow direct-engine values.

Tests:
- CLI golden-output test.
- Hash stability test.
- Mocked HTTP route test.
- Queued job polling fixture test.
- Serialization byte-size test.

Guardrail:
- Preserve existing CLI flags or keep aliases.
- Do not claim browser throughput from this script.

### P2 - Browser Site Timing Attachment

[STATUS: IN-PROGRESS. The attachment slot exists (`attachMlBioEvidenceBrowserTiming`, `browser_site_default_current` lane, `submitToResultsMs` / `firstPaintMs` / `allRenderedMs`), and the report correctly blocks browser-speed claims until timing is attached. Gaps: (1) no actual browser-timing PRODUCER exists anywhere (no Playwright/Puppeteer E2E that drives the real 500-ref converter path and posts timings back), so the lane stays unattached; (2) corpus-hash and reference-count mismatch rejection on attach is not implemented.]

Scope:
- Browser/E2E diagnostics around the real converter path.
- `server/src/admin/mlBioEvidenceReport.ts` browser timing attachment.
- Admin diagnostics route tests.

Execution:
1. Produce an attachable browser timing artifact for the 500-reference pasted corpus.
2. Capture submit-to-results, first rendered reference, first paint, all rendered, output count, response bytes, and quality hashes.
3. Reject attachment when corpus hash or reference count does not match the report target.

Acceptance metrics:
- Browser lane is labelled `browser_site_default_current`.
- Report blocks browser-speed claims until browser timing is attached.
- Mismatched browser artifacts cannot attach to the wrong report.

Tests:
- Browser artifact schema test.
- Attachment merge test.
- Corpus hash mismatch test.
- Real converter E2E timing test when browser/server are available.

Guardrail:
- Do not alter parse profile, skip UI rendering, bypass polling, or use direct engine as the browser measurement.

### P3 - Approved Truth To BIO Export Audit

[STATUS: IN-PROGRESS. `bioSupervisionExport.ts` now records per-field projection method (exact/normalized/fuzzy/unmatched) and score, a `ProjectionReport` aggregate (matched/unmatched field values, method counts, unmatched-by-field), row-level `projection_status` / `unprojected_fields` / `needs_review`, and separates approved-truth vs learning-queue rows by provenance. Gaps vs acceptance: no standalone `bio_supervision_audit.json` is written; rows with unmatched critical fields are flagged but still emitted (no hard block on silent critical-field loss); no duplicate-hash drop count or punctuation/author-reorder breakdown. NOTE: the broader 3-signal consensus loop (`bioConsensus.ts`) that this audit feeds is built.]

Scope:
- `server/src/training/bioSupervisionExport.ts`
- related tests and admin export routes

Execution:
1. Add audit output around substring/token span matching.
2. Report exact matches, normalized matches, fuzzy matches, multiple candidate spans, chosen occurrence, not-found fields, reordered authors, punctuation variants, duplicate hashes, and skipped draft/quarantined rows.
3. Emit row-level loss reasons and aggregate counts.
4. Block promotion readiness when critical fields are silently dropped or ambiguous.

Acceptance metrics:
- `bio_supervision_audit.json` records row-level and aggregate export quality.
- Critical fields cannot disappear without an audit reason.
- Real, synthetic, and admin-approved rows are separated.

Tests:
- Repeated title/publisher fixture.
- Repeated author fixture.
- DOI prefix stripping fixture.
- Punctuation variant fixture.
- Reordered authors fixture.
- Missing literal value fixture.
- Duplicate DOI/title-year split leakage fixture.

Guardrail:
- First change is audit-only.
- Do not change generated training data unless behind an explicit experimental resolver flag.

### P4 - BIO Dataset And Evaluation Metrics

[STATUS: DONE. Span->BIO->span round-trip and field-contamination checks exist (`convert_spans_to_bio.py`, `validate_gold_dataset.py`); split-leakage is handled by deduped-stratified splitting (`split_dataset.py`) plus work/DOI/near-dup-key leakage checks (`truthCertification.ts`). Evaluation goes well beyond token accuracy: entity exact F1 + per-label F1 (`train_bio_bundle.py`), and a product tier with accept-without-edit rate, mean field similarity, BIO-validity rate, and a confident-wrong (hallucination) rate, with real/synthetic/admin stratum breakdown (`eval_bio_model.py`, `bio_eval_metrics.py`). NOTE on splits: `split_dataset.py` emits train/val/test only; a `holdout` bucket is supported at the trainer via a per-row `dataset_split == "holdout"` marker (`train_bio_bundle.py`), not auto-generated by the splitter.]

Scope:
- `ml-service/datasets/citation-bio/scripts/*`
- `ml-service/tools/train_bio_bundle.py`
- `ml-service/tools/eval_jsonl.py`
- `ml-service/tests/*bio*`

Execution:
1. Add span-to-BIO-to-span round-trip checks.
2. Add split leakage checks by raw hash, normalized hash, DOI, and title-year key.
3. Add real/synthetic/admin-approved breakdown.
4. Extend evaluation beyond token accuracy to entity exact F1, entity overlap F1, field exact F1, row exact match, critical-field loss count, hallucinated fields, malformed sequence count, overlap count, grounding failures, accepted patch precision, rejected-good-patch rate, and fallback reasons.

Acceptance metrics:
- BIO eval can explain field usefulness, not only token accuracy.
- Synthetic bootstrap scores are never merged into real holdout promotion proof.

Tests:
- Span round-trip test.
- Split leakage test.
- High-token-accuracy but bad-field-extraction fixture.
- Real/synthetic separation test.

Guardrail:
- Do not promote or retrain the live model as part of this work.
- Do not hand-edit tokenizer labels; regenerate from span gold.

### P5 - Admin BIO Promotion Gates

[STATUS: IN-PROGRESS (backend partial, UI not built). `evaluateBioPromotionGate` (in the admin truth route, real file `adminTruthRoutes.ts`) checks gates before promotion but hard-blocks ONLY on structural validity (valid bundle, is-a-BIO-token-classifier, has training data); holdout-eval presence, Phase-4 shadow history, and benchmark-artifact presence are ADVISORY (non-blocking). The code's stated rationale: human review in the Review queue IS the quality gate, so it blocks only on structural validity. Gaps: no gate-card UI in `AdminBioTraining.tsx`, no plain-English blocked-reason display, no hard-regression gate, no required-passing-holdout gate. The frontend promote button is disabled only when busy or when there is no staged version.]

Scope:
- `server/src/routes/adminTruthRoutes.ts`
- `frontend/client/src/components/AdminBioTraining.tsx`
- admin training types/tests

Execution:
1. Show gate cards for lane completeness, data audit, BIO eval, real holdout, hard regressions, staged bundle, live bundle, and promotion eligibility.
2. Block staged BIO promotion unless evidence artifacts exist and required gates pass.
3. If an override is permitted later, require explicit reason and artifact IDs.
4. Make UI wording clear that bundle promotion is not the same as full BIO live primary parsing.

Acceptance metrics:
- Admin cannot promote a staged BIO bundle without required evidence, unless an explicit audited override path exists.
- UI distinguishes live bundle, Phase 4 runtime mode, and site behavior.

Tests:
- Route test for promotion blocked when audit is missing.
- Route test for failed eval.
- UI test for gate display.
- Audit-log test for override if override is implemented.

Guardrail:
- Do not imply promoted BIO bundle means BIO is live primary parser.

### P6 - Phase 4 Attribution-Only Diagnostics

[STATUS: DONE. `extractionMeta.ts` defines `ExtractionBioDebug` (tokens, labels, offsets, confidences, entities, diagnostics, schema/feature/model versions) and `ShadowDiff` (baseline vs ML fields, per-field same/added/removed/changed, `severityScore`); `phase4Extract.ts` builds the shadow diff (`buildShadowDiff`) and merges BIO diagnostics; `onnx_extractor.py` emits malformed-BIO ("unclosed_bio_sequence") and overlapping-span diagnostics. These are additive diagnostic fields — live primary output is unchanged.]

Scope:
- `server/src/engine/phases/phase4Extract.ts`
- `server/src/engine/types/extractionMeta.ts`
- ML/BIO evidence report attribution sections

Execution:
1. Add attribution-only details for heuristic value, raw BIO value, accepted patch, rejected patch, fallback reason, grounding result, malformed BIO diagnostics, and field diff.
2. Add optional offline candidate-primary comparison lane inside diagnostics only.
3. Keep current live output unchanged.

Acceptance metrics:
- Every BIO-influenced field can be explained as accepted, rejected, fallback, or no-op.
- Candidate-primary exists only in diagnostics and cannot affect `site_default`.

Tests:
- Golden batch parity test showing current output unchanged.
- Field-diff snapshot tests.
- Malformed BIO fallback test.
- Accepted/rejected patch precision fixture.
- Critical-field loss fixture.

Guardrail:
- Do not make BIO full primary.
- Do not widen selective patch fields.
- Do not change fallback rules.
- Do not let candidate-primary affect site default, render, health, or dedupe.

### P7 - Style/Type ML Shadow Gates

[STATUS: IN-PROGRESS / PARTIAL. Style ML and type ML are served and evaluated as separate bundles (`style_classifier.py`, `type_classifier.py`; consumed in `phase3StyleDetect.ts`, `phase6TypeClassify.ts`). Gaps vs the gate intent: no dedicated shadow/dual-lane comparison with confusion matrices and render/status-impact reporting in the evidence path; type ML, when it succeeds, is assigned to the carrier type rather than held strictly shadow-only. The "do not let type ML affect render/status without separate proof" guardrail is honored only insofar as deterministic routing runs first.]

Scope:
- `ml-service/app/style_classifier.py`
- `ml-service/app/type_classifier.py`
- `server/src/engine/phases/phase3StyleDetect.ts`
- `server/src/engine/phases/phase6TypeClassify.ts`
- evidence report type/style sections

Execution:
1. Evaluate style ML and type ML separately from BIO extraction.
2. Add confusion matrices and render/status impact for type changes.
3. Keep type ML shadow/guarded until it beats deterministic routing on gold and hard batches.

Acceptance metrics:
- Type/style ML cannot change render or status without proof of improvement and no readiness regression.

Tests:
- Style exact accuracy by family.
- Type macro F1 by reference type.
- Journal/report, conference/book-chapter, webpage/article, thesis/report confusion fixtures.
- Render-diff impact test for type changes.

Guardrail:
- Do not let type ML affect rendering or public status yet.

### P8 - Health, Action Needed, And Duplicate Gates

[STATUS: IN-PROGRESS / PARTIAL. Health now decides public readiness status (`decidePublicStatus` in `phase10Health.ts`) and — new since this plan — detects confident-wrong present fields (`detectImplausiblePresentFields`, surfaced as `suspect_author_value` / `suspect_locator_value` review warnings). Dedup categorizes duplicate reasons by method (`duplicateReasonForPair`, `methodCounts`) non-destructively. Gaps: readiness/action-needed/duplicate deltas are not yet wired as explicit promotion BLOCKERS inside the evidence report, and there is no per-phase status-change attribution trail.]

Scope:
- `server/src/admin/mlBioEvidenceReport.ts`
- `server/src/engine/phases/phase9Dedup.ts`
- `server/src/engine/phases/phase10Health.ts`
- relevant regression fixtures

Execution:
1. Treat readiness, action-needed, and duplicate changes as promotion blockers.
2. Require visible reasons for action-needed references.
3. Break duplicate causes down by method and audit false positives/false negatives.
4. Any ML lane that changes status must provide a field-level cause.

Acceptance metrics:
- No promotion candidate passes if it increases unexplained action-needed, false duplicate groups, or hidden status changes.

Tests:
- Duplicate precision fixture.
- Action-needed reason snapshot.
- Health stability when fields are unchanged.
- Status-change attribution test.

Guardrail:
- Measure health/dedupe as blockers first; do not redesign thresholds until evidence identifies the failure mode.

### P9 - Phase 4 Refactor After Gates

[STATUS: PENDING (barely started, correctly gated). A `server/src/engine/phases/phase4/` directory exists but currently holds only `extractionContract.ts` (DOI-resolution contract); `phase4Extract.ts` is still a ~25k-line monolith. This matches the plan's intent that the ownership split waits until P0–P8 gates are stable — and several of those (P1, P2, P5, P7, P8) are not yet complete, so this remains correctly deferred.]

Scope:
- Phase 4 extraction and helper modules only after P0-P8 evidence is stable.

Execution:
1. Split Phase 4 by ownership: base heuristic extraction, field parsers, BIO routing/patching, grounding/validation, late repairs, provenance/diagnostics, and field normalization helpers.
2. First refactor must be move-only with output parity.

Acceptance metrics:
- Field hashes, rendered hashes, semantic hashes, readiness counts, duplicate groups, and stage timings remain equivalent unless a deliberate behavior change is separately approved.

Tests:
- Full real-world batch suites.
- Raw unstructured, pasted, numbered, multiline, and PDF-copy stress suites if split-adjacent logic is touched.
- Phase output snapshots.
- Permanent regressions for every discovered bug.

Guardrail:
- Do not refactor before evidence and regression gates are locked.
- Do not combine move-only refactor with behavior changes.

## Parallel Workstreams

Workstream A: throughput truth

1. P0 evidence contract and lane truth.
2. P1 diagnostics artifact.
3. P2 browser timing attachment.

This answers: what is the real 500-reference site speed, and how does it differ from direct engine throughput?

Workstream B: BIO promotion truth

1. P3 approved-truth export audit.
2. P4 BIO dataset and evaluation metrics.
3. P5 admin BIO promotion gates.
4. P6 Phase 4 attribution-only diagnostics.

This answers: is BIO data and evaluation reliable enough to justify changing Phase 4 behavior?

## Final Gate Before Behavior Changes

No runtime behavior change should happen until:

- backend route, queued job, and browser lanes are measured or explicitly marked missing
- browser speed is reported only from browser timing
- quality gates pass before refs/sec is valid
- BIO export audit has no silent critical-field loss
- real, synthetic, and admin-approved metrics are separated
- BIO eval includes entity, field, row, and critical-field metrics
- admin promotion is blocked when evidence is incomplete
- Phase 4 output parity remains unchanged after attribution instrumentation

## Must Not Change Yet

- Do not make BIO the live full primary Phase 4 parser.
- Do not allow full ML output to overwrite heuristic fields.
- Do not enable BIO for Phase 1 or Phase 2 splitting.
- Do not change split behavior without the full split rerun scope.
- Do not use synthetic bootstrap results as real-world promotion proof.
- Do not collapse real, synthetic, and admin-approved metrics into one score.
- Do not let type ML affect render or public status yet.
- Do not mix provider or LLM enrichment into parser gold truth.
- Do not claim browser/site throughput from direct-engine diagnostics.
- Do not refactor Phase 4 before field/render/hash regressions are locked.
- Do not promote a BIO bundle just because token accuracy improves.
