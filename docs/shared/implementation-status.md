# BulkReferences Engine Implementation Status

> **📌 Status note — updated 2026-06-25.** This document predates recent engineering work; parts below are point-in-time. Key changes since: the **BullMQ** queue layer described here was vestigial and has been **removed** (the live async path is in-process `queueMicrotask`); **enrichment is enabled** behind `FEATURE_LIVE_ENRICH` (+cache+budget); **AMA / ACS / Chicago-notes** render natively (no APA fallback); **pages, ISBN, and author-parsing** are fixed; health now flags confident-wrong fields; the **DeterministicResolver** DOI migration has started. See **[System Assessment](../engine/system-assessment.md)** for the live status.


## Sprint 1

Implemented:

- Centralized engine error-code layer and app error handling
- Phase 1 ingestion/input profiling for `text` and `doi_list`
- Phase 2 block aggregation, splitting, and `CountAudit`
- Shared `/v1/inspect` route wired directly to Phase 1 + Phase 2
- Canonical runtime enums for API validation (single source used by routes)
- Unit tests for Phase 1, Phase 2, and count-audit invariants
- Integration test for inspect count consistency

Key files:

- `server/src/engine/errors/`
- `server/src/engine/types/runtime-enums.ts`
- `server/src/engine/phases/phase1Ingest.ts`
- `server/src/engine/phases/phase2Split.ts`
- `server/src/routes/inspect.ts`
- `server/src/routes/convert.ts`

## Sprint 2

Implemented:

- Mandatory field schema lookup and confidence thresholds
- Overwrite-policy helpers for enrichment and LLM fallback
- Core pipeline utilities for empty extracted fields and carrier creation
- Phase 3 style detection with heuristic fallback and immutable `carrier.style`
- Phase 4 extraction with heuristic field recovery
- Phase 5 author disambiguation with regex fallback
- Phase 6 reference-type classification with rule fallback
- Phase 6.5 fallback repair path with overwrite guards (and post-repair type re-check for standard flow)
- Phase 7 normalization with applied-rule audit trail
- Ingestion format provenance carried forward (envelope → blocks → carriers)
- Node ML client scaffold plus circuit-breaker scaffold
- Python `ml-service` FastAPI scaffold with `/ml/health`, `/ml/detect-style`, `/ml/extract`, `/ml/author-ner`, and `/ml/classify-type`
- Unit tests for Phases 3 through 7, overwrite policy, mandatory field lookup, and style immutability

Key files:

- `server/src/engine/mandatory-fields.ts`
- `server/src/engine/overwrite-policy.ts`
- `server/src/engine/utils/type-classification.ts`
- `server/src/engine/phases/phase3StyleDetect.ts`
- `server/src/engine/phases/phase4Extract.ts`
- `server/src/engine/phases/phase5AuthorDisambig.ts`
- `server/src/engine/phases/phase6TypeClassify.ts`
- `server/src/engine/phases/phase6_5LLMFallback.ts`
- `server/src/engine/phases/phase7Normalize.ts`
- `server/src/engine/types/ingestion.ts` (format meta on blocks)
- `server/src/engine/types/carrier.ts` (ingestion meta on carriers)
- `server/src/ml/client.ts`
- `server/src/pipeline/circuitBreaker.ts`
- `ml-service/app/main.py`

## Sprint 3

Implemented:

- Phase 8 enrichment with Crossref/OpenAlex provider scaffolds and confidence-gated overwrites
- Phase 10 quality scoring with public-status mapping
- Phase 12 rendering for APA, MLA, Chicago author-date, and Vancouver outputs
- Shared pipeline orchestrator for sync conversion
- `/v1/convert` synchronous path with shared count-audit lineage
- DOI fast-path for `doi_list`
- Batch fan-out for the Phase 3 through Phase 6 core path
- Eager TXT export persistence for completed jobs
- Sprint 3 unit and integration coverage for enrichment, scoring, rendering, count parity, overwrite guards, and DOI fast-path

Key files:

- `server/src/engine/phases/phase8Enrich.ts`
- `server/src/engine/phases/phase10Score.ts`
- `server/src/engine/phases/phase12Render.ts`
- `server/src/pipeline/orchestrator.ts`
- `server/src/routes/convert.ts`

## Sprint 4

Implemented:

- Runtime-backed async job queue for large conversions
- `/v1/jobs/:id` polling route
- `/v1/jobs/:id/stream` SSE replay route
- `/v1/convert/upload` multipart upload path
- Phase 9 deduplication scaffold with DOI exact and title-year grouping
- Phase 11 authority validation scaffold with isolated failure handling
- Lazy export generation for `txt`, `bib`, `ris`, `csv`, and `docx`
- `/v1/export/:jobId/:format` route
- Sprint 4 integration coverage for async jobs, upload conversion, SSE replay, export generation, authority isolation, and partial-success envelopes

Key files:

- `server/src/jobs/runtime.ts`
- `server/src/runtime/store.ts`
- `server/src/routes/jobs.ts`
- `server/src/routes/export.ts`
- `server/src/engine/phases/phase9Dedup.ts`
- `server/src/engine/phases/phase11Authority.ts`
- `server/src/export/serializers.ts`

## Sprint 5

Implemented:

- Phase 13 feedback/report and correction intake routes
- In-memory `citation_versions` audit trail
- Admin review routes for reports, corrections, learning queue, stats, and citation reprocessing
- Admin approval flow that writes `admin_confirmed` field sources
- API key create/list/delete routes
- Regression suite loader and runner with markdown publishing to `docs/test-results/`
- Nine initial regression suites covering raw text, numbered batches, PDF-copy stress, DOI fast-path, duplicates, authority flags, website-author negatives, and mixed styles
- Sprint 5 integration coverage for admin-confirmed protection across reprocessing, report queues, key management, and regression publishing

Key files:

- `server/src/routes/feedback.ts`
- `server/src/routes/keys.ts`
- `server/src/routes/admin.ts`
- `server/src/routes/regression.ts`
- `server/src/admin/workflows.ts`
- `server/src/regression/fixtures.ts`
- `server/src/regression/runner.ts`

## Sprint 6

Implemented:

- Daily reference quota enforcement and concurrent async-job caps
- Runtime maintenance helpers for export cleanup and authority recheck sweeps
- Circuit-breaker integration coverage
- Error-envelope consistency checks
- Acceptance-style tests for runtime guardrails
- API contract documentation for inspect, convert, jobs, export, feedback, keys, and admin surfaces

Key files:

- `server/src/runtime/guardrails.ts`
- `server/src/runtime/maintenance.ts`
- `server/test/integration/guardrails.test.ts`
- `server/test/unit/pipeline/circuitBreaker.integration.test.ts`
- `server/test/unit/runtime/maintenance.test.ts`
- `docs/api-contracts.md`

## Verification

- `pnpm -F server build`
- `pnpm -F server test`

Current verification baseline (see Sprint 9 section for latest):

- 33 test files
- 115 passing tests
- regression markdown output emitted to `docs/test-results/`

## Sprint 7 — Production-Grade Depth

Implemented:

- Docker Compose for local PostgreSQL 16 + Redis 7 infrastructure
- `.env.example` with all environment variables documented
- Zod-based environment validation in `config.ts`
- **Real external API clients**: CrossRef (polite pool, bibliographic search), OpenAlex (DOI + title lookup), OpenAI GPT-4.1-nano (LLM repair), Retraction Watch via CrossRef API
- **Redis caching layer** (`services/cache.ts`) with TTL, fire-and-forget safety, hit/miss stats
- **Phase 1**: BibTeX and RIS format parsing; PDF/DOCX file ingest markers for ML service extraction
- **Phase 6.5**: Real LLM fallback using OpenAI with prompt engineering, confidence tracking, and token usage metering
- **Phase 9**: Full MinHash + LSH deduplication (128-permutation signatures, 16-band LSH, 0.85 Jaccard threshold, Union-Find clustering)
- **Phase 11**: API-backed authority validation combining heuristic checks with CrossRef retraction data, author conflict detection
- **Phase 12**: citeproc-js CSL rendering for non-guaranteed styles; hand-rolled renderers preserved for guaranteed styles (APA7, MLA9, Chicago, Vancouver) with post-render assertion checking
- **Phase 13**: Feedback loop phase wired into orchestrator — applies approved user corrections and active learning insights
- **Real DOCX export** using `docx` npm package (hanging indents, Times New Roman 12pt, italic handling)
- **BullMQ workers**: pipeline (concurrency 3), export (concurrency 2), authority recheck (rate-limited 30/min), regression *(superseded — the BullMQ worker layer has since been removed; async jobs now run in-process via `queueMicrotask`, see Production Readiness Status)*
- **Auth enforcement**: Fastify plugin scoping with `requireAuth`, `optionalAuth`, `requireAdmin` on all route groups
- **Rate limiting**: `@fastify/rate-limit` with Redis backend in production, user ID or IP keying
- **SSE endpoint** (`/v1/jobs/:jobId/events`) for real-time job progress streaming
- **Persistence facade** (`runtime/persistence.ts`) — all routes/workers import from persistence, which delegates to in-memory (dev/test) or Postgres (production) via `dbStore.ts`
- **Drizzle ORM migrations** generated for 23 tables from `schema.ts`
- **Graceful shutdown** with SIGTERM/SIGINT handling, queue/DB/Redis cleanup
- **Health endpoint** (`/health`) checking Postgres + Redis connectivity
- **ML service**: real model loading via `ModelRegistry` with LRU eviction, `pdfplumber` PDF parser, `python-docx` DOCX parser, enhanced NER/scoring endpoints

Key files:

- `docker-compose.yml`, `.env.example`
- `server/src/config.ts` (Zod env validation)
- `server/src/index.ts` (graceful shutdown)
- `server/src/services/crossref.ts`, `openalex.ts`, `openai.ts`, `retractionWatch.ts`, `cache.ts`
- `server/src/engine/phases/phase9Dedup.ts` (MinHash + LSH)
- `server/src/engine/phases/phase6_5LLMFallback.ts` (OpenAI integration)
- `server/src/engine/phases/phase11Authority.ts` (Retraction Watch API)
- `server/src/engine/phases/phase12Render.ts` + `csl/engine.ts` (citeproc-js)
- `server/src/engine/phases/phase13FeedbackLoop.ts`
- `server/src/runtime/persistence.ts`, `dbStore.ts`
- `server/src/queue/pipelineWorker.ts`, `exportWorker.ts`, `authorityWorker.ts`, `regressionWorker.ts`
- `server/src/routes/sse.ts`, `health.ts`
- `server/src/middleware/auth.ts`
- `server/src/db/migrations/0000_fearless_selene.sql`
- `ml-service/app/main.py`, `models/loader.py`, `parsers/pdf_parser.py`, `parsers/docx_parser.py`

## Sprint 8 — Phase 4 Runtime Integration

Implemented:

- Shared pipeline dependency factory so sync convert, async jobs, admin reprocess, queue workers, and regression runs all use the same ML-capable Phase 3 to Phase 6 stage instances
- Phase 4 rollout contract with `ML_PHASE4_MODE = heuristic | shadow | primary`
- Deterministic Phase 4 routing using normalized raw-input hash plus active model version
- Phase 4 ML-style allowlist for `apa7`, `mla9`, `vancouver`, `ieee`, `harvard-ctr`, `chicago-author-date`, `chicago-notes-bib`, and `unknown`
- Explicit ML bypass for `ama` and `acs`
- Updated `HttpMLClient.extract()` contract:
  - batched `{ texts, styles }`
  - max 128 items per request
  - 25-second timeout
  - one retry with one-second backoff
  - HTTP `200` full success and HTTP `207` partial success support
- Updated `/ml/health` contract reporting `status`, `activeModelVersion`, `featureVersion`, `artifactsReady`, and `lastSuccessfulInferenceAt`
- Phase 4 structured ML mapping into engine `FieldValue`s with per-item heuristic fallback on partial failures and full-batch heuristic fallback on total ML failure
- `extractionMeta` persisted on citations, with append-only `citation_extraction_history` support in both in-memory and database backends
- `shadowDiff` capture limited to heuristic Phase 4 output vs ML Phase 4 output
- Feedback/training snapshot enrichment with engine prediction metadata and opt-in training eligibility
- Unit coverage for ML client contract handling, extraction rollout behavior, and extraction-history persistence

Key files:

- `server/src/pipeline/dependencies.ts`
- `server/src/pipeline/orchestrator.ts`
- `server/src/engine/phases/phase4Extract.ts`
- `server/src/engine/types/extractionMeta.ts`
- `server/src/ml/client.ts`
- `server/src/runtime/store.ts`
- `server/src/runtime/dbStore.ts`
- `server/src/runtime/persistence.ts`
- `server/src/db/schema.ts`
- `server/src/jobs/runtime.ts`
- `server/src/admin/workflows.ts`
- `server/src/routes/convert.ts`
- `server/src/routes/feedback.ts`
- `server/src/queue/pipelineWorker.ts`
- `server/src/queue/regressionWorker.ts`
- `server/src/regression/runner.ts`
- `ml-service/app/main.py`
- `server/test/unit/engine/phases/phase4Extract.test.ts`
- `server/test/unit/ml/client.test.ts`
- `server/test/unit/jobs/runtimeHistory.test.ts`

## Sprint 9 — Scored detection, hybrid split, and uncertainty propagation

Implemented:

- **Phase 1 — Scored multi-candidate detector** (feature-flagged): `FEATURE_SCORED_DETECTOR` enables per-format scorers (DOI list, RIS, BibTeX, numbered, hanging indent, plain text) with margin-based confidence (`sigmoid` on top vs second score), optional `DetectionOutcome` on `BatchEnvelope`, and `detection_telemetry` stage log entries (legacy vs scored agreement). Forced outcomes for `bib` / `ris` / `doi_list` source types. Reads flag from `process.env` so tests and rollout scripts can toggle without rebuilding.
- **Phase 2 — Hybrid fallback splitter** for `plain_text` / `unknown`: compares blank-line, numbered, and hanging-indent strategies; emits `splitQualityFlag` (`ok` | `low` | `sampled`), per-block `splitReason` and `blockFormat`.
- **Pipeline context**: `ctx.detectionMeta` after Phase 2 threads Phase 1 confidence + sampled + split quality into Phase 3 `buildReferenceCarrier`.
- **Carrier contract**: `carrier.detection` — `confidence`, `splitQualityFlag`, `sampled` — consumed by Phase 4 (ML bypass when split quality low and confidence low), Phase 10 health warnings (`uncertain_detection`, `low_split_quality`, `sampled_detection`), Phase 12 (render fallback when confidence or split quality is poor).
- **Inspect API**: additive `detection` envelope and `blocks[]` preview (truncated text, `splitReason`, `blockFormat`).
- **Frontend**: detection badge (format + effective confidence), low/medium confidence banners, DOI manual-mode mismatch hint, split preview uses server blocks when present.
- **Baseline script**: `server/scripts/baseline-detection.ts` — correction-rate buckets vs stored jobs (pre-rollout measurement).
- **Unit tests**: `phase1ScoredDetect.test.ts`, `phase2HybridSplit.test.ts`, `uncertaintyCascade.test.ts`.

## Maintenance Update — Style detection cleanup (2026-04-05)

Implemented:

- Cleanup-only refactor of style-detection thresholds so family commit, exact-style commit, certainty, and smoothing cutoffs are centralized in one place instead of repeated as inline literals
- Cleanup-only extraction of shared Vancouver helper predicates for canonical semicolon spines, biomedical comma spines, and trailing identifier handling, reducing duplicated inline regex logic in exact-style commitment
- Regression fixture typing tightened to use canonical engine style/family types instead of plain strings
- Real-world Cureus batch fixture cleanup with named expected block-count constant instead of a magic number in the phase-3 corpus test
- No product behavior or scoring policy changes intended; this work was limited to structural cleanup and maintainability

Key files:

- `server/src/engine/styleDetection.ts`
- `server/src/regression/fixtures.ts`
- `server/test/fixtures/cureusDrugDiscoveryBatch.ts`
- `server/test/unit/engine/phases/phase3StyleDetect.realBatch.test.ts`

Verification:

- `pnpm --dir server exec vitest run test/unit/engine/phases/phase2Split.test.ts src/regression/fixtures.test.ts test/unit/engine/phases/phase10Score.test.ts test/unit/engine/phases/phase12Render.test.ts src/engine/styleResolution.test.ts src/engine/styleDetection.test.ts src/engine/heuristicsMode.test.ts test/unit/engine/phases/phase3StyleDetect.test.ts test/unit/engine/phases/phase3StyleDetect.realBatch.test.ts`
- `pnpm --dir server run build`
- `pnpm --dir frontend run build`

## Frontend Auth Stability Update (2026-04-05)

Implemented:

- Shared public user-session provider so Clerk and WorkOS-backed session state is no longer fetched independently by every component using `useUserSession()`
- Local snapshot seeding for public user session, matching the existing admin-session stability pattern and removing logged-in navbar flicker on routine remounts
- Event-driven public auth refresh flow that revalidates on actual identity changes instead of repeated tab-visibility churn
- OAuth runtime event hardening so WorkOS loading-state transitions no longer emit `USER_AUTH_SESSION_EVENT`; only real session identity changes do
- Admin auth probe cleanup removing `visibilitychange` / `pagehide` revalidation, so tab switching does not trigger background admin-session checks
- Institutional login flow cleanup removing redundant manual session refresh after WorkOS user hydration; provider-driven auth sync is now the single source of truth
- `OAuthRuntimeProvider` props aligned with actual usage so it can be mounted as a sync-only component without requiring `children`

Key files:

- `frontend/client/src/providers/user-session-provider.tsx`
- `frontend/client/src/hooks/use-user-session.ts`
- `frontend/client/src/providers/admin-auth-provider.tsx`
- `frontend/client/src/oauth/OAuthRuntimeProvider.tsx`
- `frontend/client/src/main.tsx`
- `frontend/client/src/pages/institutional-login.tsx`

Verification:

- `pnpm --dir frontend run build`
- `pnpm --dir server run build`
- attempted TypeScript CLI typecheck from repo root, but the workspace does not expose `tsc` on that path (`pnpm exec tsc --noEmit -p frontend/tsconfig.json` failed before execution because `tsc` was not available from the root command context)

Key files:

- `server/src/config.ts` (`FEATURE_SCORED_DETECTOR` in Zod schema)
- `server/src/engine/phases/phase1Ingest.ts`
- `server/src/engine/phases/phase2Split.ts`
- `server/src/engine/phases/phase3StyleDetect.ts`
- `server/src/engine/phases/phase4Extract.ts`
- `server/src/engine/phases/phase10Health.ts`
- `server/src/engine/phases/phase12Render.ts`
- `server/src/engine/utils/carriers.ts`
- `server/src/engine/types/ingestion.ts`, `carrier.ts`, `api.ts`, `pipeline.ts`
- `server/src/pipeline/orchestrator.ts`
- `server/src/routes/inspect.ts`
- `server/scripts/baseline-detection.ts`
- `frontend/client/src/lib/engine-types.ts`
- `frontend/client/src/components/reference-input.tsx`
- `server/test/unit/engine/phases/phase1ScoredDetect.test.ts`
- `server/test/unit/engine/phases/phase2HybridSplit.test.ts`
- `server/test/unit/engine/phases/uncertaintyCascade.test.ts`

## Verification

- `pnpm -F server build`
- `pnpm -F server test`

Current verification baseline:

- 33 test files
- 115 passing tests
- TypeScript strict mode with `exactOptionalPropertyTypes` — zero errors
- regression markdown output emitted to `docs/test-results/`
- latest full real-world regression rerun: `docs/test-results/regression-2026-04-02T00-48-14-684Z.md` (12/12 passing suites)

## Production Readiness Status

> **Corrected 2026-06-25 against current code.** This section is the live status; the sprint history above is point-in-time (see the status banner at the top).

The engine is in production-oriented operation, deployed as **Render (backend) + Vercel (frontend)**. The Phase 4 runtime ML path is wired through the real engine entry points; the remaining ML work is mostly offline-system work, not request-path wiring:

- **17-phase pipeline**: All phases are wired in `server/src/pipeline/orchestrator.ts` with real implementations. The "13 phases" are 13 numbered stages plus runtime extension stages **P5.8 StructuralFamilyRouter** and **P6.8 SharedRepair** (and the optional **P6.5 LLM fallback**), with **Phase 10 covering both scoring and health** (`phase10Score.ts` is a re-export alias of `phase10Health.ts`). See `docs/engine/phase-index.md` for the canonical map and runtime order.
- **Async job processing**: In-process via `queueMicrotask` scheduled from the runtime-job dispatcher (`server/src/jobs/runtime.ts`) — **not** a BullMQ/Redis worker fleet. BullMQ has been removed from the request/job path (the `bullmq`/`ioredis` entries remain in `package.json` but nothing under `server/src` imports them). **Redis is optional**, used only for auth-revocation checks and the provider/report-limiter caches; the system runs without it.
- **External APIs**: CrossRef, OpenAlex, OpenAI, Retraction Watch, and Semantic Scholar clients exist with caching and configurable timeouts. Live provider enrichment runs only when **`FEATURE_LIVE_ENRICH`** is on (default **OFF**, with a provider cache and a per-provider per-job call budget); with it off, conversion is fully offline.
- **Rendering**: Phase 12 has **9 first-class hand-rolled renderers** — `apa7`, `mla9`, `chicago-author-date`, `vancouver`, `ieee`, `harvard-ctr`, `ama`, `acs`, `chicago-notes-bib` — with citeproc-js (`csl/engine.ts`) as the fallback for other styles. AMA / ACS / Chicago-notes-bib render natively (no APA fallback).
- **Persistence**: Dual-backend architecture (in-memory for dev/test, Postgres via Drizzle ORM for production); schema currently defines ~36 tables (`server/src/db/schema.ts`).
- **DOI handling**: `doi_list` takes a fast path that resolves fields from the local Approved-Truth cache (and authority pack), behind a **`DeterministicResolver`** seam the codebase is migrating toward; the DOI slice (`resolveDoi`) is wired live, the rest of that contract is types-only.
- **Authentication**: Enforced on all route groups with tiered access (public, optional, required, admin).
- **Observability / health**: Health checks, SSE progress streaming, structured logging, stage timing. Health classification now also flags **confident-wrong** fields (e.g. `suspect_author_value`, `suspect_locator_value`) instead of only missing/low-confidence fields.
- **ML service**: BIO field tagging is an **ONNX BiLSTM served by FastAPI (`ml-service`, port 8123)**. ML is **default-off in the fast lane** (`core_parse_fast` disables extraction ML); the heuristic extractor is the user-visible default and mandatory fallback. `ML_PHASE4_MODE` defaults to `heuristic`.
- **Admin training**: Approved-truth governance, certification, and BIO review surfaces exist (`frontend/client/src/components/admin-training/`, `server/src/training/`, `server/src/routes/adminTruthRoutes.ts`).
- **Format detection rollout**: Scored detector and hybrid split ship behind `FEATURE_SCORED_DETECTOR`; inspect/preview expose detection + split reasons; uncertainty flows to health and render paths.
- **Current ML gap**: offline training, artifact promotion, and approved-truth consensus export are only partially scaffolded and not yet complete.
- **Test isolation**: External services automatically mocked in test environment via conditional exports.

## Sprint 10 — Governed truth export and ONNX robustness harness

Implemented:

- Approved-truth governance fields plus learning-queue provenance link (`promoted_to_truth_id`)
- Flat JSONL v1 contract for `/internal/admin/training-export`
- Server-side normalization of engine-style values into flat `expected_fields`
- Admin training UI pagination over approved-truth rows
- Integration coverage for approved-truth CRUD, dedupe, export, and queue promotion
- Python JSONL validator and metrics module
- Offline ONNX eval harness using the same extraction path as `/ml/extract`
- CI smoke workflow for fixture validation and eval skip/pass behavior when no ONNX bundle is present

Key files:

- `server/src/training/truthFields.ts`
- `server/src/routes/adminTruthRoutes.ts`
- `server/test/unit/training/truthFields.test.ts`
- `server/test/integration/adminTraining.test.ts`
- `ml-service/app/training_dataset.py`
- `ml-service/app/metrics.py`
- `ml-service/app/models/loader.py`
- `ml-service/app/models/onnx_extractor.py`
- `ml-service/tools/eval_jsonl.py`
- `ml-service/tools/stub_train.py`
- `ml-service/README_TRAINING.md`
- `docs/training-export-schema.md`
- `.github/workflows/training-eval-smoke.yml`
