# BulkReferences Citation Engine — v1 Implementation Plan

> **📌 Status note — updated 2026-06-25.** This document predates recent engineering work; parts below are point-in-time. Key changes since: the **BullMQ** queue layer described here was vestigial and has been **removed** (the live async path is in-process `queueMicrotask`, scheduled from the runtime-job dispatcher; **Redis is now optional**, used only for auth-revocation checks and the provider cache); the pipeline is now **17 modules**, not 13 (new runtime stages **P5.8 StructuralFamilyRouter** and **P6.8 SharedRepair**, plus Phase 10 covering both Health and Score — see §6); **enrichment is implemented** behind `FEATURE_LIVE_ENRICH` (default OFF) with a provider cache and a 50-call/provider per-job budget; **AMA / ACS / Chicago-notes-bib** render natively (no APA fallback) — 9 first-class styles total; **pages, ISBN, and author-parsing** are fixed; health now flags confident-wrong fields; the **DeterministicResolver** DOI migration has started; deployment is **Render (backend) + Vercel (frontend)**, not Hetzner/Railway. Wherever the body below describes BullMQ/Redis-required queues, `13 phases`, enrichment as unbuilt, or VPS deployment, treat the status note and the per-section corrections as authoritative. See **[System Assessment](system-assessment.md)** for the live status.


> **Status**: Approved for execution
> **Scope**: Full rip-and-replace of the heuristic/regex CitationParser with an ML pipeline (originally specced at 13 phases; now **17 modules** — see §6)
> **Pipeline Major**: `3` (all records stamped with this version via `pipelineMajor`)
> **Last Updated**: 2026-04-02 (point-in-time; see 2026-06-25 status note above)

---

## Table of Contents

1. [Architecture & Infrastructure](#1-architecture--infrastructure)
2. [Database Schema](#2-database-schema)
3. [Type System](#3-type-system)
4. [Job System Design](#4-job-system-design)
5. [Public API Contracts](#5-public-api-contracts)
6. [Pipeline (17 Modules)](#6-17-module-pipeline)
7. [Mandatory Field Schemas (54 Combos)](#7-mandatory-field-schemas)
8. [Python ML Microservice](#8-python-ml-microservice)
9. [Testing Strategy](#9-testing-strategy)
10. [Build Order](#10-build-order)
11. [Deployment](#11-deployment)
12. [Gaps, Risks & Decisions Log](#12-gaps-risks--decisions-log)

---

## 1. Architecture & Infrastructure

### 1.1 Design Principles

1. **One engine only.** No user-selectable engine versions. Internal `pipelineMajor = 3` and per-stage `contractVersion` integers for replay, migrations, and auditability.
2. **Inspect/convert count parity.** The same block-aggregation + splitting logic that powers `/v1/inspect` feeds `/v1/convert`. Count drift between preview and conversion is a hard blocker — `droppedCount` must always be `0`.
3. **Enrichment is confidence-gated.** Provider data may fill empty fields unconditionally. It may overwrite model-extracted values only when provider confidence ≥ 0.85 AND exceeds existing confidence. It may **never** overwrite admin-confirmed values.
4. **LLM fallback is powerful but bounded.** GPT-5.4 nano can fill all fields when it is highly confident about the reference identity (≥ 0.85). It may never overwrite admin-confirmed values.
5. **No silent drops.** Uncertain or low-confidence blocks become citations with `publicStatus = 'needs_action'`, never discarded.
6. **Partial success by default.** Failed references carry error metadata through the full pipeline. Batch failure only for infrastructure-level errors.
7. **Correction hierarchy.** `admin_confirmed > provider_enriched > model_extracted > pending_user_correction > regex_fallback > empty`. Pending user corrections are suggestions until admin-approved.
8. **Scored format detection (optional).** When `FEATURE_SCORED_DETECTOR=true`, Phase 1 runs a multi-candidate scored detector (margin-based confidence via sigmoid) instead of legacy first-match heuristics only. Legacy detection still runs in parallel for telemetry (agreement rate). UI gates use **effective confidence** (sampled inputs get a fixed discount). Backend quality rules use raw detection confidence where specified.
9. **Split quality on carriers.** After Phase 2, each carrier carries `detection.splitQualityFlag` (`ok` | `low` | `sampled`) alongside Phase 1’s `confidence` and `sampled`, so Phases 4, 10, and 12 can downgrade ML routing, health, or render paths when boundaries or format detection are uncertain.

### 1.2 Component Topology

> **⚠️ Superseded (2026-06).** The diagram below described **BullMQ workers + Redis-as-queue** on a Hetzner/Railway VPS. That layer was vestigial and has been removed. Reality today:
> - **Async is in-process.** Large jobs (`estimatedCount > PIPELINE_SYNC_THRESHOLD`, default 500) are saved as `pending`, then run via `queueMicrotask` in the same Node process (`server/src/jobs/runtime.ts`). There are no BullMQ queues, no worker shells, and no separate worker process.
> - **Redis is optional.** The core runtime does not require Redis (`config.ts`: `REDIS_URL` optional). When present it is used only for auth-revocation checks and (when `FEATURE_LIVE_ENRICH` is on, or in `balanced` `REDIS_USAGE_MODE`) the persistent provider cache and rate limits. Postgres is the system of record; the job snapshot is also held in an in-memory map with a DB fallback.
> - **Deployment is Render (backend) + Vercel (frontend)**, not VPS-1/VPS-2. The ML service is a separate process but no longer a "VPS-2 Hetzner CX21" box in this doc's sense.
>
> The boxes below remain a useful sketch of *logical* components (Fastify ↔ orchestrator ↔ Drizzle/Postgres ↔ ML service) — read "BullMQ Workers" as "in-process `queueMicrotask` dispatcher" and ignore the VPS labels.

```
┌─────────────────────────────────────────────────────────────────────┐
│                         CLIENT (React/Vite on Vercel)               │
│  POST /v1/inspect  ·  POST /v1/convert  ·  GET /v1/jobs/:id        │
│  SSE /v1/jobs/:id/stream  ·  GET /v1/export/:jobId/:format         │
└───────────────────────────────┬─────────────────────────────────────┘
                                │ HTTPS
┌───────────────────────────────▼─────────────────────────────────────┐
│              Render: Node.js API (single process)                   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐  │
│  │   Fastify     │  │  in-process  │  │   Pipeline Orchestrator  │  │
│  │ (routes, auth,│  │  async       │  │  (17-module executor)    │  │
│  │  rate-limit,  │  │ (queue-      │  │                          │  │
│  │  multipart)   │  │  Microtask)  │  │  Circuit Breaker for     │  │
│  └──────┬───────┘  └──────┬───────┘  │  ML service calls        │  │
│         │                  │          └──────────┬───────────────┘  │
│  ┌──────▼──────────────────▼────────────────────▼──────────────┐   │
│  │        Drizzle ORM + optional Redis client (cache only)      │   │
│  └──────┬───────────────────────────────────────┬──────────────┘   │
│         │                                        │                  │
│  ┌──────▼──────┐                        ┌────────▼────────┐        │
│  │  PostgreSQL  │  ← system of record   │  Redis (OPT)     │       │
│  │  (Drizzle)   │                       │  auth-revoke +   │       │
│  │              │                       │  provider cache  │       │
│  └─────────────┘                        └─────────────────┘        │
└─────────────────────────────────┬───────────────────────────────────┘
                                  │ HTTP REST (batch endpoints)
┌─────────────────────────────────▼───────────────────────────────────┐
│                    Python ML Microservice (separate process)        │
│  FastAPI · ONNX Runtime · Lazy model loading                        │
│                                                                     │
│  POST /ml/split          — line-pair classifier                     │
│  POST /ml/detect-style   — DistilBERT style detection               │
│  POST /ml/extract        — SciBERT+CRF field extraction             │
│  POST /ml/author-ner     — AffilGood author NER                     │
│  POST /ml/classify-type  — DistilBERT type classification           │
│  POST /ml/score          — quality regression model                 │
│  POST /ml/ingest-pdf     — pdfplumber extraction                    │
│  POST /ml/ingest-docx    — python-docx extraction                   │
│  GET  /ml/health         — readiness + model load status            │
└─────────────────────────────────────────────────────────────────────┘

External APIs (all free tier; live calls gated by FEATURE_LIVE_ENRICH, default OFF):
  ├── CrossRef REST API    — DOI resolution, metadata enrichment (Phase 8)
  ├── OpenAlex API         — venue metadata, open access, citation counts (Phase 8)
  ├── Semantic Scholar     — last-resort enrichment (Phase 8; optional x-api-key)
  ├── OpenAI API           — gpt-5.4-nano (LLM repair / Phase 6.5 fallback)
  └── Retraction Watch     — retraction checks (Phase 11)

Object Storage:
  └── Cloudflare R2        — uploads, exports, regression artifacts (S3-compatible; export offload optional)
```

### 1.3 Data Flow — Single Request

```
Client POST /v1/convert
  │
  ├── estimatedCount ≤ PIPELINE_SYNC_THRESHOLD (default 500)?
  │     YES → Synchronous (direct response)
  │     NO  → save job 'pending' → queueMicrotask in-process → return jobId (202) → Client SSE or polls
  │           (NOT a BullMQ enqueue — see §4)
  │
  ▼
Pipeline Orchestrator.runConvertPipeline(input)
  │
  Phase 1: Ingest + Input Profiling + DOI Detection
  │   → BatchEnvelope { sourceType, structure, detectedFormat, formatConfidence,
  │                     estimatedCount, hasDois, styleHints, rawText, detectedDois[],
  │                     optional detection: DetectionOutcome (scored path) }
  │   → DOI Fast Path: if DOI resolves fully via CrossRef/OpenAlex
  │     → Build carrier from provider metadata
  │     → SKIP Phases 2–8, enter at Phase 9 (Dedup)
  │
  Phase 2: Block Aggregation + Splitting + CountAudit
  │   → RawBlock[] (no silent drops — uncertain → needs_action; splitReason + blockFormat for preview)
  │   → CountAudit { inputEstimate, aggregatedCount, splitCount, delta }
  │   → splitQualityFlag (hybrid splitter consistency vs threshold for plain_text / unknown)
  │
  Phase 3: Style Detection (per block, full text)
  │   → carrier.style is set and immutable for that reference downstream
  │
  ┌─── Per-block parallel fan-out (batches, maxConcurrency from runtime tuning) ──┐
  │ Phase 4:   Field Extraction (heuristic primary; ML routed per ML_PHASE4_MODE) │
  │ Phase 5:   Author Disambiguation (AffilGood NER, routed)                  │
  │ Phase 5.8: Structural Family Router (assigns reference family/type seam)  │
  │ Phase 6:   Reference Type Classification (routed)                         │
  └────────────────────────────────────────────────────────────────────────────┘
  │
  Phase 6.5: LLM Fallback (gpt-5.4-nano) — OPTIONAL (ctx.options.llmFallback)
  │   → Fires only when mandatory fields missing or low confidence
  │   → Can fill all fields when referenceConfidence ≥ 0.85
  │   → NEVER overwrites admin-confirmed values
  │
  Phase 6.8: Shared Repair (cross-field consistency repair; runs on every lane)
  │
  Phase 7: Normalization
  │
  Phase 8: Enrichment (confidence-gated overwrite) — OPTIONAL
  │   → Gated by FEATURE_LIVE_ENRICH (default OFF) + tier allowance + provider cache
  │   → CrossRef + OpenAlex + Semantic Scholar; 50-call/provider per-job budget
  │   → May overwrite model values if provider confidence ≥ 0.85
  │   → NEVER overwrites admin-confirmed values
  │
  Phase 9: Duplicate Clustering (non-destructive)
  │   → DOI fast-path refs rejoin here
  │
  Phase 10: Health + Quality Scoring (phase10Health; phase10Score is an alias)
  │   → Internal: rawScore/displayScore + confident-wrong field flags
  │   → Public: ready | needs_review | needs_action
  │
  Phase 11: Authority Validation + Retraction Check — OPTIONAL (ctx.options.authorityValidation)
  │
  Phase 12: Rendering + Export (9 first-class style renderers)
  │   → Eager: TXT export generated immediately
  │   → Lazy: BibTeX/RIS/CSV/DOCX on first download request
  │
  Phase 13: Feedback Loop / Approved-Truth overlays — OPTIONAL (ctx.options.feedbackLoop)
  │
  ▼
Response Envelope → Client
```

> **Note on execution policy.** Which optional stages run is decided by the resolved `parseProfile` (see `executionPolicy.ts`). The fast lane (`core_parse_fast`) turns ML, providers, LLM, authority, and feedback **off**; `core_parse_full` enables routed ML + local authority + feedback; `core_parse_full_enrich` additionally turns Phase 8 enrichment on. The default request profile is `core_parse_full`. ML in Phase 4 is **off in the fast lane** and otherwise routed by `ML_PHASE4_MODE` (default `heuristic`).

### 1.4 Communication Protocols

| Path | Protocol | Timeout |
|------|----------|---------|
| Client → Node API | HTTPS | 30s sync, unlimited SSE |
| Node API → Python ML | HTTP REST (batch POST) | 10s per batch |
| Node API → CrossRef | HTTPS | 3s |
| Node API → OpenAlex | HTTPS | 3s |
| Node API → OpenAI | HTTPS | 8s |
| Node API → Retraction Watch | HTTPS | 2s |
| Node API → Postgres | TCP (Drizzle/pg pool) | 5s |
| Node API → Redis (OPTIONAL) | TCP (ioredis) — auth-revoke + provider cache only | 1s |

> Note: the ML timeout above (`ML_SERVICE_TIMEOUT_MS`) defaults to **25s** in `config.ts`, and Crossref/OpenAlex/Retraction-Watch timeouts are configurable (3s/3s/2s defaults). The 10s ML figure is the original design target, not the current default.

### 1.5 Circuit Breaker (ML Service)

```
Failure threshold:  5 consecutive failures within 60s
Reset timeout:      30 seconds
Half-open:          1 probe request before full open

On OPEN state — per-phase fallbacks:
  Phase 2 (split):     regex-only splitting (numbered lists, blank lines)
  Phase 3 (style):     heuristic regex patterns per style
  Phase 4 (extract):   heuristic extractor remains primary fallback; failed ML items degrade per-item or per-batch without failing conversion
  Phase 5 (author):    regex-based author parsing
  Phase 6 (type):      rule-based from field presence
  Phase 10 (score):    rules-based scoring (field completeness heuristics)
```

### 1.6 Batch Parallel Processing

For large inputs the pipeline fans out in configurable parallel batches across the core extraction stages:

```
PIPELINE_BATCH_CONFIG (config.ts defaults):
  batchSize:       64 references per batch        (PIPELINE_BATCH_SIZE)
  maxConcurrency:  4 batches running in parallel  (PIPELINE_MAX_CONCURRENCY)

Optional worker-thread fan-out (PIPELINE_FAST_WORKERS_ENABLED, default on):
  core_parse_fast lane only, ≥ PIPELINE_FAST_MULTICORE_MIN_REFS (default 256)
  → core batches run across worker_threads, otherwise in-process Promise.all

Example: 500 refs → ceil(500/64) = 8 batches → 4 concurrent → 2 waves

Fan-out scope: Phases 4, 5, 5.8, 6 run per batch (the "core" batch)
Fan-in point:  Phase 6.5 (LLM) collects flagged refs across batches when enabled
Sequential:    Phases 6.8, 7, 8, 9, 10, 11, 12, 13 run on the full merged carrier set
```

---

## 2. Database Schema

All tables defined via Drizzle ORM. File: `server/db/schema.ts`

### 2.1 Tenant & Auth Tables

```sql
-- Organizations
CREATE TABLE organizations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(200) NOT NULL,
  domain      VARCHAR(200),
  tier        VARCHAR(20) DEFAULT 'free',    -- free | pro | b2b
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- Users
CREATE TABLE users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID REFERENCES organizations(id),
  email           VARCHAR(255) UNIQUE NOT NULL,
  name            VARCHAR(160),
  password_hash   VARCHAR(255) NOT NULL,
  tier            VARCHAR(20) DEFAULT 'free',
  daily_ref_count INTEGER DEFAULT 0,
  daily_ref_reset TIMESTAMPTZ DEFAULT now(),
  is_admin        BOOLEAN DEFAULT false,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

-- Projects (user workspaces)
CREATE TABLE projects (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES users(id),
  org_id      UUID REFERENCES organizations(id),
  name        VARCHAR(200) NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- API Keys
CREATE TABLE api_keys (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key_hash     VARCHAR(64) UNIQUE NOT NULL,
  key_prefix   VARCHAR(8) NOT NULL,      -- e.g. "br_live_" for display
  name         VARCHAR(80),
  tier         VARCHAR(20) DEFAULT 'free',
  rate_limit   INTEGER,                   -- custom override for B2B
  is_active    BOOLEAN DEFAULT true,
  last_used_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_api_keys_hash ON api_keys(key_hash);
CREATE INDEX idx_api_keys_user ON api_keys(user_id);

-- Sessions
CREATE TABLE sessions (
  id          VARCHAR(128) PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

-- Usage Tracking
CREATE TABLE usage (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES users(id),
  org_id      UUID REFERENCES organizations(id),
  api_key_id  UUID REFERENCES api_keys(id),
  period      DATE NOT NULL,
  ref_count   INTEGER DEFAULT 0,
  job_count   INTEGER DEFAULT 0
);
CREATE INDEX idx_usage_user_period ON usage(user_id, period);
CREATE INDEX idx_usage_org_period ON usage(org_id, period);
```

### 2.2 Engine Tables

```sql
-- Ingested Sources (raw file artifacts)
CREATE TABLE ingested_sources (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id         UUID REFERENCES jobs(id) ON DELETE CASCADE,
  source_type    VARCHAR(20) NOT NULL,     -- text|pdf|docx|doi_list|txt|bib|ris
  blob_key       VARCHAR(500),             -- R2 object key
  raw_text_hash  VARCHAR(64),              -- SHA-256
  file_size      INTEGER,
  page_count     INTEGER,
  retained_until TIMESTAMPTZ,
  created_at     TIMESTAMPTZ DEFAULT now()
);

-- Jobs
CREATE TABLE jobs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID REFERENCES users(id),
  org_id           UUID REFERENCES organizations(id),
  project_id       UUID REFERENCES projects(id),
  api_key_id       UUID REFERENCES api_keys(id),
  idempotency_key  VARCHAR(128) UNIQUE,
  status           VARCHAR(20) DEFAULT 'pending',
                   -- pending | processing | completed | partial | failed
  execution_mode   VARCHAR(10) DEFAULT 'sync',
  source_type      VARCHAR(20) NOT NULL,
  input_hash       VARCHAR(64),              -- SHA-256 for idempotency
  output_style     VARCHAR(40) NOT NULL DEFAULT 'apa7',
  options          JSONB DEFAULT '{}',
                   -- { enrich, dedup, group, debug, retentionPolicy }
  pipeline_major   INTEGER NOT NULL DEFAULT 3,
  total_refs       INTEGER DEFAULT 0,
  processed_refs   INTEGER DEFAULT 0,
  failed_refs      INTEGER DEFAULT 0,
  current_phase    VARCHAR(30),
  count_audit      JSONB,                    -- CountAudit snapshot
  summary          JSONB,
  failed_indices   INTEGER[] DEFAULT '{}',
  retry_payload    JSONB,                    -- { inputs[], hint } for failed refs
  started_at       TIMESTAMPTZ,
  completed_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_jobs_user ON jobs(user_id);
CREATE INDEX idx_jobs_status ON jobs(status);
CREATE INDEX idx_jobs_hash ON jobs(input_hash);
CREATE INDEX idx_jobs_created ON jobs(created_at);

-- Job Attempts (for replay/retry audit)
CREATE TABLE job_attempts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id          UUID REFERENCES jobs(id) ON DELETE CASCADE,
  attempt_number  INTEGER NOT NULL,
  status          VARCHAR(20) NOT NULL,
  error           JSONB,
  stage_log       JSONB DEFAULT '[]',     -- StageRunRecord[]
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ
);

-- Batches (split groups within a job)
CREATE TABLE batches (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id        UUID REFERENCES jobs(id) ON DELETE CASCADE,
  batch_index   INTEGER NOT NULL,
  raw_blocks    JSONB NOT NULL,            -- RawBlock[] after aggregation
  count_audit   JSONB NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- Citations (the core output)
CREATE TABLE citations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id            UUID REFERENCES jobs(id) ON DELETE CASCADE,
  batch_id          UUID REFERENCES batches(id),
  user_id           UUID REFERENCES users(id),
  reference_index   INTEGER NOT NULL,
  raw_text          TEXT NOT NULL,
  reference_type    VARCHAR(40) DEFAULT 'unknown',
  detected_style    VARCHAR(40),
  output_style      VARCHAR(40) NOT NULL,
  pipeline_major    INTEGER NOT NULL DEFAULT 3,

  -- Public-facing status (what the user sees)
  public_status     VARCHAR(20) NOT NULL DEFAULT 'needs_review',
                    -- ready | needs_review | needs_action

  -- Internal processing status
  status            VARCHAR(20) DEFAULT 'active',
                    -- active | duplicate | flagged | failed

  duplicate_of      UUID REFERENCES citations(id),

  -- Field extraction (all fields as FieldValue<T> JSON)
  fields            JSONB NOT NULL DEFAULT '{}',

  -- Scoring
  raw_score         REAL,
  display_score     REAL,
  score_bucket      VARCHAR(1),            -- A | B | C | D (internal only)

  -- Authority
  authority_flags   JSONB DEFAULT '[]',
  authority_checked_at TIMESTAMPTZ,

  -- Rendered output
  rendered_text     TEXT,
  rendered_warnings TEXT[] DEFAULT '{}',

  -- Per-stage metadata
  stage_log         JSONB DEFAULT '[]',    -- StageDiagnostic[]
  split_meta        JSONB,
  extraction_meta   JSONB,
  enrichment_meta   JSONB,
  normalization_meta JSONB,
  provenance_meta   JSONB,

  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_citations_job ON citations(job_id);
CREATE INDEX idx_citations_user ON citations(user_id);
CREATE INDEX idx_citations_status ON citations(status);
CREATE INDEX idx_citations_public ON citations(public_status);
CREATE INDEX idx_citations_bucket ON citations(score_bucket);
CREATE INDEX idx_citations_doi ON citations USING GIN ((fields->'doi'->'value'));
CREATE INDEX idx_citations_created ON citations(created_at);

-- Citation Versions (audit trail for corrections)
CREATE TABLE citation_versions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  citation_id  UUID REFERENCES citations(id) ON DELETE CASCADE,
  version_num  INTEGER NOT NULL,
  fields       JSONB NOT NULL,
  changed_by   VARCHAR(20),               -- system | user | admin | llm | enrichment
  change_source VARCHAR(40),              -- specific phase or action
  changed_at   TIMESTAMPTZ DEFAULT now()
);

-- Duplicate Groups
CREATE TABLE duplicate_groups (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id        UUID REFERENCES jobs(id) ON DELETE CASCADE,
  primary_id    UUID REFERENCES citations(id),
  member_ids    UUID[] NOT NULL,
  method        VARCHAR(20),               -- minhash_lsh | doi_exact
  jaccard_score REAL,
  auto_merged   BOOLEAN DEFAULT false,
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- Export Artifacts
CREATE TABLE export_artifacts (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id         UUID REFERENCES jobs(id) ON DELETE CASCADE,
  format         VARCHAR(10) NOT NULL,     -- txt | bib | ris | csv | docx
  blob_key       VARCHAR(500),             -- R2 key
  inline_content TEXT,                     -- inline for small outputs
  size_bytes     INTEGER,
  retained_until TIMESTAMPTZ,
  created_at     TIMESTAMPTZ DEFAULT now()
);

-- Provider Cache (CrossRef, OpenAlex, Semantic Scholar)
CREATE TABLE provider_cache (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider    VARCHAR(20) NOT NULL,        -- crossref | openalex | semantic_scholar
  cache_key   VARCHAR(128) NOT NULL UNIQUE,
  payload     JSONB NOT NULL,
  hit_count   INTEGER DEFAULT 0,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_provider_cache_key ON provider_cache(cache_key);
CREATE INDEX idx_provider_cache_expires ON provider_cache(expires_at);

-- Authority Checks
CREATE TABLE authority_checks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  citation_id     UUID REFERENCES citations(id),
  doi             VARCHAR(200),
  retraction_hit  BOOLEAN DEFAULT false,
  expression_of_concern BOOLEAN DEFAULT false,
  author_conflict BOOLEAN DEFAULT false,
  flags           JSONB DEFAULT '[]',
  checked_at      TIMESTAMPTZ,
  next_recheck_at TIMESTAMPTZ              -- 30-day rolling
);
```

### 2.3 Reports, Corrections & Learning Tables

```sql
-- Citation Reports (Phase 13, Flow 1)
CREATE TABLE citation_reports (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  citation_id         UUID REFERENCES citations(id) ON DELETE CASCADE,
  user_id             UUID REFERENCES users(id),
  source              VARCHAR(20) DEFAULT 'user',  -- user | auto | user_edit
  failure_category    VARCHAR(30) NOT NULL,
  failure_categories  TEXT[] DEFAULT '{}',
  user_note           TEXT,
  status              VARCHAR(20) DEFAULT 'pending',
                      -- pending | proposed | accepted | rejected | duplicate
  fingerprint         VARCHAR(64),                 -- SHA-256 for dedup
  report_count        INTEGER DEFAULT 1,
  ip_hash             VARCHAR(64),
  engine_snapshot     JSONB,
  stage_blame         JSONB,
  corrected_fields    JSONB,
  resolution_trace    JSONB,
  created_at          TIMESTAMPTZ DEFAULT now(),
  resolved_at         TIMESTAMPTZ
);
CREATE INDEX idx_reports_citation ON citation_reports(citation_id);
CREATE INDEX idx_reports_status ON citation_reports(status);
CREATE INDEX idx_reports_fingerprint ON citation_reports(fingerprint);

-- User Corrections (Phase 13, Flow 2 — silent edits)
CREATE TABLE user_corrections (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  citation_id     UUID REFERENCES citations(id) ON DELETE CASCADE,
  user_id         UUID REFERENCES users(id),
  field_name      VARCHAR(60) NOT NULL,
  old_value       JSONB,
  new_value       JSONB,
  correction_type VARCHAR(20),              -- edit | merge | retype
  status          VARCHAR(20) DEFAULT 'pending',
                  -- pending | consensus_candidate | approved | rejected | auto_applied
  reviewed_by     UUID REFERENCES users(id),
  reviewed_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_corrections_citation ON user_corrections(citation_id);
CREATE INDEX idx_corrections_status ON user_corrections(status);

-- Approved Truth (verified canonical references)
CREATE TABLE approved_truth (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  input_hash      VARCHAR(64) NOT NULL UNIQUE,
  raw_text        TEXT NOT NULL,
  expected_fields JSONB NOT NULL,
  expected_type   VARCHAR(40),
  expected_style  VARCHAR(40),
  provenance      VARCHAR(50),              -- manual | auto | user_correction
  pipeline_major  INTEGER,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

-- Active Learning Queue
CREATE TABLE active_learning_queue (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  citation_id     UUID REFERENCES citations(id),
  correction_id   UUID REFERENCES user_corrections(id),
  report_id       UUID REFERENCES citation_reports(id),
  source          VARCHAR(20),              -- user_edit | user_report | auto_flag
  maturity_level  VARCHAR(20) DEFAULT 'manual',
                  -- manual | semi_auto | fully_auto
  priority        INTEGER DEFAULT 0,
  training_data   JSONB NOT NULL,
  processed       BOOLEAN DEFAULT false,
  processed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_learning_queue_processed ON active_learning_queue(processed, priority DESC);

-- Regression Fixtures
CREATE TABLE regression_fixtures (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  suite_name      VARCHAR(80) NOT NULL,
  verbatim_input  TEXT NOT NULL,
  expected_output JSONB NOT NULL,
  failure_mode    VARCHAR(60),
  provenance      VARCHAR(50),
  is_active       BOOLEAN DEFAULT true,
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- Regression Runs
CREATE TABLE regression_runs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_at          TIMESTAMPTZ NOT NULL,
  pipeline_major  INTEGER NOT NULL,
  stage_id        VARCHAR(50),
  suite_name      VARCHAR(80),
  pass_count      INTEGER DEFAULT 0,
  fail_count      INTEGER DEFAULT 0,
  skip_count      INTEGER DEFAULT 0,
  failures        JSONB DEFAULT '[]',
  triggered_by    VARCHAR(30)               -- ci | manual | tuning_change
);

-- Legacy Citations (historical records)
CREATE TABLE legacy_citations (
  citation_id     UUID REFERENCES citations(id),
  legacy_version  TEXT,
  missing_fields  JSONB DEFAULT '[]',
  review_status   TEXT DEFAULT 'unreviewed',
  flagged_at      TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (citation_id)
);
```

### 2.4 Retention Policy

| Data | TTL | Storage |
|------|-----|---------|
| Upload blobs | 24 hours | Cloudflare R2 |
| Raw extracted input | 30 days | Cloudflare R2 |
| Job outputs / diagnostics | 180 days | Cloudflare R2 |
| Provider cache | 30 days | Postgres + optional Redis |
| Export artifacts | 180 days | Cloudflare R2 |
| Reports, approved_truth, regression_fixtures | Permanent | Postgres |

### 2.5 Redis Key Patterns

> **⚠️ Superseded.** Redis is **optional** — the core runtime no longer requires it (`config.ts`: `REDIS_URL` optional; "The core runtime no longer requires Redis"). There are **no BullMQ queues**; the async path is in-process `queueMicrotask`. The `bull:engine-v3-*` keys below no longer exist. When Redis is configured it is used for auth-revocation checks and (under `FEATURE_LIVE_ENRICH`, or `balanced` `REDIS_USAGE_MODE`) the persistent provider cache and rate limits. `REDIS_USAGE_MODE` defaults to `queue_first` (reserve memory for revocation checks); `balanced` also enables Redis-backed rate limits and provider caches. The cache-key shapes below are still representative of the provider/rate-limit caches.

```
# (REMOVED) BullMQ queue keys no longer exist:
#   bull:engine-v3-pipeline:*  bull:engine-v3-export:*  bull:engine-v3-authority-recheck:*  ...

# Cache keys (application-managed, only when Redis is configured)
crossref:{doi}                → JSON   TTL 24h
crossref:search:{hash}        → JSON   TTL 6h
openalex:{doi}                → JSON   TTL 24h
openalex:search:{hash}        → JSON   TTL 6h
ml:style:{hash}               → JSON   TTL 1h
ml:extract:{hash}             → JSON   TTL 1h
doi:resolve:{doi}             → JSON   TTL 24h

# Rate limiting
ratelimit:user:{id}:{date}    → int    TTL 25h
ratelimit:api:{hash}:{min}    → int    TTL 2m
ratelimit:ip:{hash}:{min}     → int    TTL 2m

# Circuit breaker state
circuit:ml-service             → JSON   TTL 5m
  { state: 'closed'|'open'|'half-open', failures: number, lastAttempt: ISO }
```

---

## 3. Type System

All types in `server/engine/types/` with barrel export at `index.ts`.

### 3.1 Core Field Value

```typescript
// types/field.ts

export type FieldSource =
  | 'ml_extraction'            // Phase 4: SciBERT+CRF
  | 'ml_author_ner'            // Phase 5: AffilGood
  | 'ml_type_classifier'       // Phase 6: DistilBERT
  | 'llm_fallback'             // Phase 6.5: GPT-5.4 nano
  | 'normalization'            // Phase 7
  | 'enrichment_crossref'      // Phase 8
  | 'enrichment_openalex'      // Phase 8
  | 'user_correction'          // Phase 13 (pending, not yet admin-confirmed)
  | 'admin_confirmed'          // Phase 13 (admin-approved, NEVER overwritable)
  | 'regex_fallback'           // any phase, ML unavailable
  | 'doi_resolution'           // Phase 1: DOI → metadata
  | 'ingestion'                // Phase 1: BibTeX/RIS structured input
  ;

export interface FieldValue<T> {
  value: T;
  confidence: number;              // 0.0–1.0
  source: FieldSource;
  stageId: string;                  // e.g. 'phase4_extraction'
  uncertain: boolean;               // true when confidence < per-field threshold
  previousValue?: T;                // before last write (audit trail)
  previousSource?: FieldSource;
}

export function fieldOf<T>(
  value: T,
  source: FieldSource,
  stageId: string,
  confidence = 1.0
): FieldValue<T> {
  return {
    value,
    confidence,
    source,
    stageId,
    uncertain: confidence < 0.7,
  };
}

export function emptyField<T>(stageId: string): FieldValue<T | null> {
  return fieldOf<T | null>(null, 'ml_extraction', stageId, 0);
}
```

### 3.2 Citation & Field Types

```typescript
// types/citation.ts

export type ReferenceType =
  | 'article-journal' | 'book' | 'book-chapter' | 'thesis'
  | 'conference-paper' | 'webpage' | 'report' | 'dataset'
  | 'preprint' | 'unknown';

export type CitationStyle =
  | 'apa7' | 'mla9' | 'chicago-author-date' | 'chicago-notes-bib'
  | 'vancouver' | 'ieee' | 'harvard-ctr' | 'ama' | 'acs'
  | 'unknown' | 'auto';

// Styles with full acceptance testing and rendering guarantees
export type GuaranteedStyle = 'apa7' | 'mla9' | 'chicago-author-date' | 'vancouver';

export interface CanonicalAuthor {
  family: string;
  given: string | null;
  initials: string | null;
  literal?: string;              // for corporate/institutional authors
  orcid?: string;
  isCorporate: boolean;
}

export interface ExtractedFields {
  authors:            FieldValue<CanonicalAuthor[]>;
  title:              FieldValue<string | null>;
  year:               FieldValue<number | null>;
  journal:            FieldValue<string | null>;
  volume:             FieldValue<string | null>;
  issue:              FieldValue<string | null>;
  pages:              FieldValue<string | null>;
  doi:                FieldValue<string | null>;
  publisher:          FieldValue<string | null>;
  placeOfPublication: FieldValue<string | null>;
  url:                FieldValue<string | null>;
  conferenceTitle:    FieldValue<string | null>;
  bookTitle:          FieldValue<string | null>;
  institution:        FieldValue<string | null>;
  edition:            FieldValue<string | null>;
  editors:            FieldValue<CanonicalAuthor[]>;
  thesisType:         FieldValue<string | null>;
  repository:         FieldValue<string | null>;
  articleNumber:      FieldValue<string | null>;
  accessedDate:       FieldValue<string | null>;
  siteName:           FieldValue<string | null>;
  database:           FieldValue<string | null>;
  reportNumber:       FieldValue<string | null>;
}

// Public-facing status (what the user sees in the UI)
export type PublicStatus = 'ready' | 'needs_review' | 'needs_action';

export interface AuthorityFlag {
  type: 'retracted' | 'expression_of_concern' | 'author_conflict' | 'metadata_mismatch';
  source: string;
  date?: string;
  details?: string;
}

export interface ProcessedCitation {
  id: string;
  index: number;                    // original input position (preserved)
  raw: string;
  publicStatus: PublicStatus;
  status: 'ok' | 'error';
  error?: {
    phase: PhaseId;
    code: string;
    message: string;
    recoverable: boolean;
  };
  partialData?: Partial<ExtractedFields>;   // fields extracted before failure
  referenceType: ReferenceType;
  detectedStyle: CitationStyle;
  outputStyle: CitationStyle;
  fields: ExtractedFields;
  rawScore: number;                 // 0-100, before authority adjustments
  displayScore: number;             // 0-100, after authority adjustments
  scoreBucket: 'A' | 'B' | 'C' | 'D';  // internal only, NOT exposed publicly
  authorityFlags: AuthorityFlag[];
  renderedText: string;
  renderedWarnings: string[];
  duplicateOf?: string;             // citation ID of the primary in its group
  isDuplicateCandidate?: boolean;
  pipelineMajor: 3;
  stageLog: StageRunRecord[];
}
```

### 3.3 Pipeline Types

```typescript
// types/pipeline.ts

export type PipelineStatus = 'success' | 'partial' | 'failed';
export type PhaseStatus = 'pending' | 'running' | 'success' | 'warning' | 'error' | 'skipped';

export type PhaseId =
  | 'ingestion'
  | 'block_aggregation'
  | 'splitting'
  | 'style_detection'
  | 'extraction'
  | 'author_disambiguation'
  | 'type_classification'
  | 'llm_fallback'
  | 'normalization'
  | 'enrichment'
  | 'deduplication'
  | 'quality_scoring'
  | 'authority_validation'
  | 'rendering'
  | 'feedback';

export interface StageRunRecord {
  stageId: string;
  contractVersion: number;
  phaseId: PhaseId;
  status: PhaseStatus;
  durationMs: number;
  inputHash?: string;
  outputHash?: string;
  message?: string;
  code?: string;
  details?: Record<string, unknown>;
}

export interface CountAudit {
  inputEstimate: number;           // from Phase 1 profiling
  aggregatedCount: number;         // after block aggregation (Phase 2)
  splitCount: number;              // after hard split (Phase 2)
  delta: number;                   // splitCount - inputEstimate
  needsActionCount: number;        // uncertain blocks tagged needs_action
  droppedCount: number;            // MUST always be 0
}

export interface ProcessingPath {
  stagesRun: PhaseId[];
  fallbacksUsed: string[];
  durationMs: number;
  partialResult: boolean;
  batchConfig: { batchSize: number; maxConcurrency: number };
  stageTimings: Array<{ phaseId: PhaseId; durationMs: number; status: PhaseStatus }>;
}

export interface PipelineContext {
  jobId: string;
  pipelineMajor: 3;
  outputStyle: CitationStyle;
  options: PipelineOptions;
  stageLog: StageRunRecord[];
  startedAt: number;
  abortSignal?: AbortSignal;
  tenantContext: TenantContext;
  /** Set after Phase 2: threads detection confidence + split quality into Phase 3 carrier build */
  detectionMeta?: {
    confidence: number;
    sampled: boolean;
    splitQualityFlag: 'ok' | 'low' | 'sampled';
  };
}

export interface PipelineOptions {
  enrich: boolean;
  dedup: boolean;
  groupDuplicates: boolean;
  debug: boolean;
  retentionPolicy: 'default' | 'extended' | 'minimal';
}

export interface TenantContext {
  userId?: string;
  orgId?: string;
  apiKeyId?: string;
  tier: 'free' | 'pro' | 'b2b';
}

/** Every pipeline stage must implement this interface */
export interface PipelineStage<TInput, TOutput> {
  readonly phaseId: PhaseId;
  readonly contractVersion: number;
  run(input: TInput, ctx: PipelineContext): Promise<TOutput>;
}
```

### 3.4 Ingestion & Splitting Types

```typescript
// types/ingestion.ts

export interface BatchEnvelope {
  pipelineMajor: 3;
  sourceType: string;
  structure: 'structured' | 'semi_structured' | 'unstructured' | 'unknown';
  detectedFormat: DetectedFormat;
  formatConfidence: number;
  estimatedCount: number;
  hasDois: boolean;
  styleHints: string[];
  rawText: string;
  detectedDois: string[];
  ingestionSignals: {
    isPdfExtracted: boolean;
    isDocxExtracted: boolean;
    hasLineNumbers: boolean;
    hasHangingIndents: boolean;
    hasBibTexEntries: boolean;
    hasRisEntries: boolean;
  };
  /** Present when FEATURE_SCORED_DETECTOR is enabled */
  detection?: DetectionOutcome;
}

/** Scored path: top two candidates, margin-based confidence, effectiveConfidence for UI */
export interface DetectionOutcome {
  chosen: DetectorResult;
  secondBest: DetectorResult | null;
  confidence: number;
  effectiveConfidence: number;
  method: 'scored' | 'forced';
  perBlockUsed: boolean;
  sampled: boolean;
}

export interface DetectorResult {
  format: DetectedFormat;
  score: number;
  evidence: string[];
  blockCoverage: number;
}

export interface RawBlock {
  index: number;
  text: string;
  formatMeta?: { detectedFormat: DetectedFormat; formatConfidence: number; /* ... */ };
  splitMethod: 'numbered' | 'hanging_indent' | 'blank_line' | 'ml_classifier'
             | 'bibtex_entry' | 'ris_entry' | 'doi_list' | 'doi_resolved' | 'uncertain';
  splitConfidence: number;
  isDoiResolved: boolean;
  resolvedFields?: ExtractedFields;
  flags: Array<'too_short' | 'too_long' | 'uncertain' | 'metadata_mismatch'>;
  /** Preview / inspect: why this block was split (e.g. number_marker, blank_line, hybrid strategy) */
  splitReason?: string;
  /** Per-block format when mixed or global format applies */
  blockFormat?: DetectedFormat;
}

export interface SplitMeta {
  method: string;
  confidence: number;
  blockLength: number;
  flags: string[];                  // 'too_short' | 'too_long' | 'uncertain'
}
```

### 3.5 Per-Phase Result Types

```typescript
// types/phase-results.ts

export interface StyleDetectionResult {
  primary: { style: CitationStyle; confidence: number };
  secondary: { style: CitationStyle; confidence: number } | null;
  isUnknown: boolean;               // primary confidence < 0.65
  isMultiStyle: boolean;            // batch contains mixed styles
}

export interface TypeClassificationResult {
  type: ReferenceType;
  confidence: number;
  isUnknown: boolean;               // confidence < 0.6
}

export interface EnrichmentResult {
  status: 'enriched' | 'partial' | 'skipped' | 'error';
  crossrefHit: boolean;
  openalexHit: boolean;
  fieldsEnriched: string[];
  fieldsOverwritten: string[];      // fields where provider beat model confidence
  cacheHits: number;
}

export interface ScoringResult {
  rawScore: number;                 // 0-100
  scoreBucket: 'A' | 'B' | 'C' | 'D';
  publicStatus: PublicStatus;
  breakdown: {
    fieldCompleteness: number;
    avgFieldConfidence: number;
    doiResolved: boolean;
    formatConfidence: number;
    enrichmentSuccess: boolean;
    mandatoryFieldsMissing: string[];
  };
}

export interface AuthorityResult {
  checked: boolean;
  displayScore: number;
  displayBucket: 'A' | 'B' | 'C' | 'D';
  flags: AuthorityFlag[];
  scoreAdjustment: number;          // how much score was reduced
  nextRecheckAt: Date;
}

export interface RenderedResult {
  text: string;
  warnings: string[];
  assertionSummary?: {
    total: number;
    passed: number;
    failed: number;
  };
}
```

### 3.6 ReferenceCarrier (Internal Pipeline Object)

```typescript
// types/carrier.ts

/**
 * Each reference flows through all phases as a ReferenceCarrier.
 * Failed references carry error metadata but are never dropped.
 * This is the "pipeline drain" pattern.
 */
export interface ReferenceCarrier {
  index: number;                    // original input position
  raw: string;
  publicStatus: PublicStatus;
  status: 'ok' | 'error';
  error?: {
    phase: PhaseId;
    code: string;
    message: string;
    recoverable: boolean;
  };
  partialData?: Partial<ExtractedFields>;
  fields: ExtractedFields;
  style: StyleDetectionResult;
  type: TypeClassificationResult;
  enrichment: EnrichmentResult;
  scoring: ScoringResult;
  authority: AuthorityResult;
  rendered: RenderedResult;
  splitMeta: SplitMeta;
  stageLog: StageRunRecord[];
  doiFastPath: boolean;
  /** Phase 1–2: detection confidence + split quality for downstream phases */
  detection?: {
    confidence: number;
    splitQualityFlag: 'ok' | 'low' | 'sampled';
    sampled: boolean;
  };
}
```

### 3.7 API Request/Response Types

```typescript
// types/api.ts

/** POST /v1/convert request */
export interface ConvertRequest {
  sourceType: 'text' | 'doi_list';
  content: string;
  outputStyle?: CitationStyle;       // default: apa7
  options?: {
    parseProfile?: ParseProfile;     // sanitized server-side; clients can only pick a non-enriching core lane
    enrich?: boolean;                // requested only; ACTUALLY applied only if FEATURE_LIVE_ENRICH is on
                                     //   AND the per-tier enrichment allowance passes (see routes/convert.ts).
                                     //   Default-off in practice.
    dedup?: boolean;
    groupDuplicates?: boolean;
    debug?: boolean;                 // default: false (and only honored when the policy allows debug)
  };
  idempotencyKey?: string;
}

/** POST /v1/convert/upload request (multipart) */
export interface UploadRequest {
  file: File;                        // PDF, DOCX, TXT, BIB, RIS
  outputStyle?: CitationStyle;
  options?: ConvertRequest['options'];
}

/** POST /v1/inspect request */
export interface InspectRequest {
  sourceType: 'text' | 'pdf' | 'docx' | 'txt' | 'bib' | 'ris' | 'doi_list';
  content: string;
}

/** POST /v1/inspect response */
export interface InspectResponse {
  estimatedCount: number;
  aggregatedCount: number;
  splitCount: number;
  countAudit: CountAudit;
  detectedFormat: string;
  detectedDois: string[];
  formatConfidence: number;
  structure: 'structured' | 'semi_structured' | 'unstructured' | 'unknown';
  styleHints: string[];
  needsActionCount: number;
  diagnostics?: StageRunRecord[];
  /** Additive: scored detector envelope when enabled */
  detection?: {
    chosen: { format: string; score: number; evidence: string[] };
    secondBest: { format: string; score: number } | null;
    confidence: number;
    effectiveConfidence: number;
    method: 'scored' | 'forced';
    perBlockUsed: boolean;
    sampled: boolean;
  };
  /** Additive: first blocks with splitReason + blockFormat for UI preview */
  blocks?: Array<{
    index: number;
    text: string;
    splitReason: string;
    blockFormat: string;
  }>;
}

/** Synchronous conversion response / async job result */
export interface ConvertResponse {
  jobId: string;
  status: PipelineStatus;           // success | partial | failed
  summary: {
    total: number;
    ready: number;
    needsReview: number;
    needsAction: number;
    failed: number;
    parseQuality: number;            // weighted average confidence
  };
  references: ProcessedCitation[];   // ALL refs, ordered by input position
  failedIndices: number[];           // original positions of failures
  duplicateGroups: Array<{
    groupId: string;
    primaryId: string;
    memberIds: string[];
    method: 'minhash_lsh' | 'doi_exact';
    jaccardScore: number;
  }>;
  exports: Array<{
    format: string;
    available: boolean;              // true if eagerly generated (txt only)
  }>;
  countAudit: CountAudit;
  processingPath: ProcessingPath;
  providerUsage: {
    crossrefCalls: number;
    openalexCalls: number;
    llmTokensUsed: number;
    cacheHits: number;
  };
  retryPayload?: {
    inputs: string[];
    hint: string;
  };
  warnings: string[];
  diagnostics?: StageRunRecord[];    // only when debug=true
}

/** Async job creation response */
export interface JobCreatedResponse {
  jobId: string;
  status: 'pending';
  estimatedDuration: number;         // seconds
  streamUrl: string;                 // SSE endpoint
  pollUrl: string;                   // polling endpoint
}

/** GET /v1/jobs/:id response */
export interface JobStatusResponse {
  jobId: string;
  status: 'pending' | 'processing' | 'completed' | 'partial' | 'failed';
  progress?: {
    totalRefs: number;
    processedRefs: number;
    currentPhase: PhaseId | null;
    percentComplete: number;
  };
  result?: ConvertResponse;          // present when status is completed|partial
  error?: {
    code: string;
    message: string;
  };
  createdAt: string;
  completedAt?: string;
}

/** SSE event types for /v1/jobs/:id/stream */
export type SSEEvent =
  | { event: 'phase_start';   data: { phase: PhaseId; timestamp: string } }
  | { event: 'phase_complete'; data: { phase: PhaseId; durationMs: number; status: PhaseStatus } }
  | { event: 'progress';      data: { processed: number; total: number; percent: number } }
  | { event: 'complete';      data: ConvertResponse }
  | { event: 'error';         data: { code: string; message: string } }
  ;
```

### 3.8 Overwrite Policy Functions

```typescript
// types/overwrite-policy.ts

const ENRICHMENT_OVERWRITE_THRESHOLD = 0.85;
const LLM_FULL_FILL_CONFIDENCE_THRESHOLD = 0.85;

/**
 * Correction hierarchy (highest to lowest):
 * admin_confirmed > provider_enriched > model_extracted > pending_user_correction > regex_fallback > empty
 *
 * admin_confirmed fields are NEVER overwritten by any phase.
 * pending user corrections CAN be overwritten by stronger model/provider evidence.
 */

export function isAdminProtected(field: FieldValue<unknown>): boolean {
  return field.source === 'admin_confirmed';
}

/** Phase 8: Enrichment overwrite policy */
export function applyEnrichmentField<T>(
  existing: FieldValue<T>,
  providerValue: T,
  providerConfidence: number,
  provider: 'crossref' | 'openalex',
  stageId: string
): FieldValue<T> {
  // HARD RULE: never overwrite admin-confirmed fields
  if (isAdminProtected(existing)) return existing;

  // Fill empty fields unconditionally
  if (existing.value === null || existing.value === undefined) {
    return fieldOf(providerValue, `enrichment_${provider}` as FieldSource, stageId, providerConfidence);
  }

  // Overwrite if provider is sufficiently confident AND more confident than existing
  if (
    providerConfidence >= ENRICHMENT_OVERWRITE_THRESHOLD &&
    providerConfidence > existing.confidence
  ) {
    return {
      ...fieldOf(providerValue, `enrichment_${provider}` as FieldSource, stageId, providerConfidence),
      previousValue: existing.value,
      previousSource: existing.source,
    };
  }

  return existing;
}

/** Phase 6.5: LLM fallback overwrite policy */
export function canLLMOverwrite(
  existing: FieldValue<unknown>,
  llmReferenceConfidence: number
): boolean {
  // Never overwrite admin-confirmed fields
  if (isAdminProtected(existing)) return false;

  // If LLM is highly confident about reference identity, can overwrite anything else
  if (llmReferenceConfidence >= LLM_FULL_FILL_CONFIDENCE_THRESHOLD) return true;

  // Otherwise, only fill null/empty fields
  return existing.value === null || existing.value === undefined;
}
```

---

## 4. Job System Design

### 4.1 In-Process Async (BullMQ removed)

> **⚠️ Superseded.** The BullMQ queue module sketched here (`server/worker/queues.ts`, named queues, worker concurrency, per-tier priority numbers, repeatable cron jobs) was **vestigial and has been removed**. No `bullmq` import exists in the live request/job path; there is no `queues.ts`, no worker shell, and no Redis-backed queue.
>
> **Current behavior** (`server/src/jobs/runtime.ts`): an async job is persisted as `status: 'pending'`, then dispatched **in-process** via `queueMicrotask` (`scheduleRuntimeJobProcessing` → `processRuntimeJob`). It runs the same `runConvertPipeline` as the sync path, in the same Node process. State lives in Postgres (system of record) plus a short-lived in-memory snapshot map. On a database backend, a claim row (`claimAsyncJobForProcessing`, `ASYNC_JOB_STALE_MS = 10m`) prevents double-processing, and `resumeRuntimeJobs()` re-schedules claimable jobs at startup. There are no BullMQ `attempts`/`backoff`/priority semantics — sync completion uses `deferPersistence` + `queueMicrotask` to persist after responding.
>
> Wherever later sections reference BullMQ (authority re-check queue in §6 Phase 11, lazy-export queue in §6 Phase 12, cleanup cron in §13.12, `worker.close()` graceful shutdown in §13.5), read them as **superseded** — those background jobs are either in-process or not yet built. The conceptual queue model below is retained only as historical design intent.

```typescript
// HISTORICAL DESIGN ONLY — not present in the codebase.
// The live dispatcher is queueMicrotask in server/src/jobs/runtime.ts.
```

### 4.2 Execution Mode Decision

> **⚠️ Corrected.** The live threshold is `PIPELINE_SYNC_THRESHOLD` (default **500**), not 25, and the gate is purely count-based in `routes/convert.ts` (it does not branch on sourceType or debug flags). DOI-lists and text both run synchronously when under the threshold.

```typescript
// Effective behavior (server/src/routes/convert.ts):
//   if (envelope.estimatedCount > env.PIPELINE_SYNC_THRESHOLD) → async (202 + jobId)
//   else                                                       → sync (200 + full result)
// Default PIPELINE_SYNC_THRESHOLD = 500.
```

### 4.3 Progress Reporting

**SSE (preferred)**:
- `GET /v1/jobs/:id/stream`
- Server pushes `phase_start`, `phase_complete`, `progress`, and final `complete` or `error` events
- Connection auto-closes on job finish
- Client reconnects with `Last-Event-ID` on disconnect

**Polling (fallback)**:
- `GET /v1/jobs/:id`
- Adaptive intervals: 500ms × 10 polls → back off to 2s → max 5s
- Returns full `JobStatusResponse` including progress percentage

---

## 5. Public API Contracts

### 5.1 Route Table

```
Method  Path                            Auth          Description
──────  ──────────────────────────────  ────────────  ─────────────────────────────────────
POST    /v1/inspect                     session|key   Shared preview — Phase 1+2 only.
                                                      Returns count + format detection.
POST    /v1/convert                     session|key   Full conversion (sync or async).
POST    /v1/convert/upload              session|key   Multipart file upload → async job.

GET     /v1/jobs/:id                    session|key   Job status + result.
GET     /v1/jobs/:id/stream             session|key   SSE progress stream.
DELETE  /v1/jobs/:id                    session|key   Cancel pending/processing job.

GET     /v1/export/:jobId/:format       session|key   Download export (txt|bib|ris|csv|docx).
                                                      Lazy-generated on first request
                                                      (except TXT which is eager).

POST    /v1/reports                     session|key   Submit failure report (Phase 13 Flow 1).
POST    /v1/corrections                 session|key   Submit field correction (Phase 13 Flow 2).

POST    /v1/auth/register               public        Create account.
POST    /v1/auth/login                  public        Login → session cookie.
POST    /v1/auth/logout                 session       Destroy session.
GET     /v1/auth/me                     session       Current user profile.

POST    /v1/keys                        session       Create API key.
GET     /v1/keys                        session       List user's API keys.
DELETE  /v1/keys/:id                    session       Revoke API key.

GET     /v1/health                      public        API health check.
GET     /v1/health/ml                   public        ML service readiness.

── Admin / Internal ────────────────────────────────────────────────────
GET     /internal/admin/reports         admin         List failure reports.
PATCH   /internal/admin/reports/:id     admin         Review/resolve report.
GET     /internal/admin/corrections     admin         List pending corrections.
PATCH   /internal/admin/corrections/:id admin         Approve/reject correction.
GET     /internal/admin/learning-queue  admin         Active learning queue.
GET     /internal/admin/stats           admin         Dashboard metrics.
POST    /internal/admin/reprocess/:id   admin         Re-run pipeline on citation.

POST    /internal/regression/run        admin         Trigger regression suite.
GET     /internal/regression/runs       admin         List regression history.

GET     /internal/pipeline/phases       admin         Phase registry + contract versions.
POST    /internal/pipeline/run-phase    admin         Run single phase (debugging).
```

### 5.2 Input Limits & Rate Limits

```
Sync vs async cutoff: PIPELINE_SYNC_THRESHOLD references (default 500) — above → in-process async job
Max text length:      CITATION_TEXT_INPUT_MAX_CHARS (see routes/requestLimits.ts)
Max upload size:      UPLOAD_MAX_BYTES (default 2,000,000 bytes)
Allowed uploads:      text-bearing files (the upload route reads multipart text)
```

> **⚠️ Note.** The fixed limits above were design targets; the live values come from config/`requestLimits.ts` (`UPLOAD_MAX_BYTES` default 2 MB, `RATE_LIMIT_MAX`/`RATE_LIMIT_WINDOW_MS` defaults 100/60s, `B2B_DAILY_REF_LIMIT` default 50,000). Per-tier reference quotas and the enrichment free-trial are enforced in `runtime/guardrails.ts`, not by the static table that previously appeared here. Treat specific per-tier req/min numbers as unverified against current config.

### 5.3 Auth Middleware

```typescript
// Dual auth: API key (X-API-Key header) checked first, then session cookie.
// Anonymous access allowed with strict rate limiting.

async function authenticate(request, reply) {
  const apiKey = request.headers['x-api-key'];
  if (apiKey) {
    const keyHash = sha256(apiKey);
    const record = await db.query.apiKeys.findFirst({
      where: eq(apiKeys.keyHash, keyHash)
    });
    if (!record?.isActive) return reply.code(401).send({ error: 'Invalid API key' });
    request.user = await db.query.users.findFirst({
      where: eq(users.id, record.userId)
    });
    request.authMethod = 'api_key';
    request.apiKeyId = record.id;
    // Update last_used_at (fire-and-forget)
    db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, record.id));
    return;
  }

  const sessionId = request.cookies['session_id'];
  if (sessionId) {
    const session = await db.query.sessions.findFirst({
      where: eq(sessions.id, sessionId)
    });
    if (!session || session.expiresAt < new Date()) {
      return reply.code(401).send({ error: 'Session expired' });
    }
    request.user = await db.query.users.findFirst({
      where: eq(users.id, session.userId)
    });
    request.authMethod = 'session';
    return;
  }

  // Anonymous — allowed with strict rate limits
  request.user = null;
  request.authMethod = 'anonymous';
}
```

### 5.4 Error Response Envelope

All errors follow a consistent shape:

```typescript
interface ErrorResponse {
  error: string;          // machine-readable code: 'RATE_LIMIT_EXCEEDED'
  message: string;        // human-readable: 'You have exceeded the daily reference limit'
  details?: string;       // optional: additional context
  retryAfter?: number;    // seconds until retry (for rate limits)
}

// HTTP status mapping:
// 400 — invalid request (bad input, validation failure)
// 401 — unauthorized (invalid/missing auth)
// 403 — forbidden (tier limit, feature not available)
// 404 — not found (job expired, resource missing)
// 409 — conflict (idempotency key collision with different input)
// 422 — unprocessable (input too large, unsupported format)
// 429 — rate limit exceeded
// 500 — internal server error
// 503 — service unavailable (ML service down, all fallbacks exhausted)
```

---

<a id="6-17-module-pipeline"></a>
## 6. Pipeline (17 Modules)

> **⚠️ Updated.** The pipeline is now commonly described as **17 modules**, not 13 (counting Phase 10's Health + Score and the optional half-step modules). The genuinely-new runtime stages since this section was written are **P5.8 Structural Family Router** and **P6.8 Shared Repair**; they are NOT documented in their own subsections below. All modules are summarized here:
>
> | # | Module | File | Notes |
> |---|--------|------|-------|
> | P1 | Ingest + profiling + DOI detect | `phase1Ingest.ts` | documented below |
> | P2 | Split + CountAudit | `phase2Split.ts` | documented below |
> | P3 | Style detect | `phase3StyleDetect.ts` | documented below |
> | P4 | Field extraction | `phase4Extract.ts` | documented below |
> | P5 | Author disambiguation | `phase5AuthorDisambig.ts` | documented below |
> | **P5.8** | **Structural Family Router** | `phase5_8StructuralFamilyRouter.ts` | **NEW** — routes each ref to a structural family/type seam before type classification; also runs on the DOI core lane. |
> | P6 | Type classification | `phase6TypeClassify.ts` | documented below |
> | P6.5 | LLM fallback (OPTIONAL) | `phase6_5LLMFallback.ts` | documented below; gated by `ctx.options.llmFallback` |
> | **P6.8** | **Shared Repair** | `phase6_8SharedRepair.ts` | **NEW** — cross-field consistency repair; runs on every lane (incl. the inline fast lane). |
> | P7 | Normalization | `phase7Normalize.ts` | documented below |
> | P8 | Enrichment (OPTIONAL) | `phase8Enrich.ts` | documented below; gated by `FEATURE_LIVE_ENRICH` + tier |
> | P9 | Dedup | `phase9Dedup.ts` | documented below |
> | P10 | Health + Score | `phase10Health.ts` (`phase10Score.ts` is a thin re-export alias of it) | Health/status validation and quality scoring run in one module (`Phase10Health`); the orchestrator calls `phase10Health.run`. |
> | P11 | Authority validation (OPTIONAL) | `phase11Authority.ts` | documented below; gated by `ctx.options.authorityValidation` |
> | P12 | Render + export | `phase12Render.ts` | documented below; 9 first-class style renderers |
> | P13 | Feedback loop (OPTIONAL) | `phase13FeedbackLoop.ts` | documented below; gated by `ctx.options.feedbackLoop` |
>
> Subsection titles below still say "Phase N — …" using the original 13-step numbering; treat them as the per-module specs for the matching module above. The original file paths in some subsection headers were `server/engine/phases/…`; the real paths are `server/src/engine/phases/…`.

### Phase 1 — Ingest + Input Profiling + DOI Detection

**File**: `server/src/engine/phases/phase1Ingest.ts`
**Contract version**: 1
**Input**: `InspectRequest` / convert request envelope
**Output**: `BatchEnvelope`

#### Format detection modes

- **Default (`FEATURE_SCORED_DETECTOR` unset or `false`)**: Legacy priority-ordered heuristics (BibTeX/RIS patterns → numbered → blank line → hanging indent → plain text / unknown). `formatConfidence` uses fixed per-format weights.
- **Scored path (`FEATURE_SCORED_DETECTOR=true`)**: Independent scorers per candidate format (DOI list, RIS, BibTeX, numbered list, hanging indent, plain text). Top two candidates drive **margin-based confidence** `sigmoid(k × (topScore − secondScore))`. **effectiveConfidence** applies a fixed discount when `sampled: true` (head/tail sampling). Forced modes (`bib`, `ris`, `doi_list` source types) emit `method: 'forced'`. A stage log record `detection_telemetry` compares legacy vs scored chosen format for rollout analysis (agreement rate).

#### Logic

1. **Route by sourceType**:
   - `text` / `doi_list`: direct passthrough
   - `pdf` / `docx`: POST to Python ML service (`/ml/ingest-pdf` or `/ml/ingest-docx`), store raw blob in R2
   - `bib` / `ris`: detect and parse structured format entries directly
   - `txt`: read file content, treat as `text`

2. **DOI detection**: scan full raw text with regex `10\.\d{4,9}/\S+`
   - Collect all detected DOIs into `detectedDois[]`
   - If entire input is DOIs (one per line, no other content): set `structure = 'structured'`

3. **Input profiling** (scan first 500 chars + full structure):
   - Detect `detectedFormat` and `structure`: structured (BibTeX/RIS/DOI list), semi_structured (numbered, indented), unstructured (prose paste), unknown
   - Count `estimatedCount` from structural signals
   - Detect `styleHints` from patterns (parenthetical years = APA, superscript numbers = Vancouver, etc.)
   - Record `ingestionSignals` (PDF artifacts, line numbers, hanging indents, etc.)
   - When scored detection is on, attach optional `detection: DetectionOutcome` to the envelope

4. **DOI fast-path resolution** *(corrected — local-cache / DeterministicResolver seam, not live providers)*:
   - The `doi_list` core lane resolves each DOI against a **reviewed local approved-truth cache** and an **authority pack** (`resolveDoiFastPath` in `orchestrator.ts`), not live CrossRef/OpenAlex calls. A cache hit yields `admin_confirmed` fields; a miss emits a **partial DOI-only parse** (`doi` + `https://doi.org/{doi}` url, plus any authority-pack type/publisher hints) tagged `needs_review`.
   - DOI resolution lives behind a **DeterministicResolver** seam that the codebase is migrating toward; live provider enrichment of DOIs happens later in Phase 8 only when `FEATURE_LIVE_ENRICH` is on.
   - DOI-resolved carriers run a reduced core lane (structural family router + type classify) and rejoin the shared tail at **Phase 6.8 / 7 → 9 (Dedup)**; they skip extraction/style ML.

5. Attach `pipelineMajor: 3` to all records

#### Error handling
- PDF extraction failure → return error with `code: 'PDF_EXTRACTION_FAILED'`, set `status: 'failed'`
- DOCX extraction failure → same pattern
- DOI resolution timeout → graceful degradation, DOI falls through to normal pipeline

---

### Phase 2 — Block Aggregation + Splitting + CountAudit

**File**: `server/src/engine/phases/phase2Split.ts`
**Contract version**: 1
**Input**: `BatchEnvelope` (minus DOI-resolved blocks)
**Output**: `{ blocks: RawBlock[], countAudit: CountAudit, splitQualityFlag }`

**Critical**: This is the SAME logic that runs in `/v1/inspect`. The `/v1/inspect` route calls Phase 1 + Phase 2 directly. No separate preview path exists. Inspect responses may include truncated `blocks[]` with `splitReason` and `blockFormat` for UI preview.

#### Hybrid fallback (`plain_text` / `unknown`)

For ambiguous formats, Phase 2 evaluates three strategies—blank-line split, numbered split, hanging-indent split—each scored for **relative** winner selection and **absolute** internal consistency. If absolute consistency is below a configurable threshold (`SPLIT_QUALITY_THRESHOLD`, default `0.60`), `splitQualityFlag` is `low`; if Phase 1 marked sampled detection, flag can be `sampled`. The winning strategy name is reflected in per-block `splitReason` where applicable.

#### Step 1: Block Aggregation (before any hard split)

- Reconstruct multiline citations using hanging-indent detection and line-length heuristics
- Remove PDF artifacts: header/footer text, page numbers, running titles, section headings
- Reconstruct split DOIs and URLs across line breaks (`doi: 10.1234/\nfoo` → `doi: 10.1234/foo`)
- Anchor the pre-split count as `aggregatedCount`

#### Step 2: Hard Split

Priority-ordered splitting strategies by `detectedFormat`:
1. **DOI list**: one block per non-empty line
2. **BibTeX/RIS entries**: parse `@article{...}` or `TY  - ...` / `ER  -` entries directly
3. **Numbered list**: regex `^\s*\[?\d+[\.\)\]]\s+` (handles `[1]`, `1.`, `1)`)
4. **Blank line**: double newline between references
5. **Hanging indent**: indent differential between first line and continuation lines
6. **plain_text / unknown**: **hybrid fallback** chooses best of blank-line, numbered, and hanging-indent splits using consistency scoring

Each materialized block includes `splitReason` (machine-readable tag for preview) and `blockFormat` (global detected format unless per-block detection extends this later).

#### Step 3: Validation Guards

- **Min length**: blocks < 20 chars → tagged `needs_action` with flag `too_short` (NOT discarded)
- **Max length**: blocks > 1200 chars → tagged `needs_action` with flag `too_long` (NOT discarded)
- **Uncertain splits**: ML confidence < 0.5 → tagged `needs_action` with `splitMethod: 'uncertain'`

#### Step 4: CountAudit

```typescript
const countAudit: CountAudit = {
  inputEstimate,                    // from Phase 1 profiling
  aggregatedCount,                  // after block aggregation
  splitCount: blocks.length,        // after hard split
  delta: blocks.length - inputEstimate,
  needsActionCount: blocks.filter(b => b.splitMethod === 'uncertain').length,
  droppedCount: 0,                  // HARD INVARIANT: always 0
};

// Emit warning if delta > 5%
if (Math.abs(countAudit.delta) / inputEstimate > 0.05) {
  stageLog.push({
    phaseId: 'splitting',
    status: 'warning',
    code: 'COUNT_AUDIT_DRIFT',
    message: `Split count (${countAudit.splitCount}) differs from estimate (${inputEstimate}) by ${countAudit.delta}`,
  });
}
```

---

### Phase 3 — Style Detection

**File**: `server/src/engine/phases/phase3StyleDetect.ts`
**Contract version**: 1
**Input**: `RawBlock[]`
**Output**: Each `ReferenceCarrier` gets `style: StyleDetectionResult` and, when the orchestrator populated `ctx.detectionMeta` after Phase 2, `carrier.detection` with Phase 1 confidence + Phase 2 `splitQualityFlag` + sampled flag

#### Logic

1. Batch all blocks and POST to `/ml/detect-style` (DistilBERT classifier)
2. Returns top-2 styles with confidence per block
3. If `primary.confidence < 0.65`: set `isUnknown: true` → triggers LLM fallback in Phase 6.5
4. Detect `isMultiStyle`: if >20% of blocks have a different primary style than the mode → `isMultiStyle = true`

#### After Phase 3, `carrier.style` is IMMUTABLE

All downstream phases access style from `carrier.style`:
- Phase 4: selects extraction patterns
- Phase 6.5: passes style in LLM prompt
- Phase 7: applies style-specific normalization rules
- Phase 12: renders to `outputStyle` but uses `carrier.style` for ambiguous field treatment

#### Circuit breaker fallback

Heuristic regex patterns:
- Parenthetical year `(2024)` after author → APA
- Period after year → Chicago
- Superscript or bracket numbers → Vancouver/IEEE
- Italicized container title → MLA

---

### Phase 4 — Field Extraction (Structured ML Contract)

**File**: `server/src/engine/phases/phase4Extract.ts`
**Contract version**: 3
**Input**: `ReferenceCarrier[]` with style set
**Output**: Each carrier gets populated `fields: ExtractedFields` plus `extractionMeta`

> **Default is heuristic.** `ML_PHASE4_MODE` defaults to **`heuristic`** (config.ts), and the **fast lane (`core_parse_fast`) disables extraction ML entirely** (`extractionMl: 'off'`). ML is only consulted on full lanes (`extractionMl: 'routed'`) when `ML_PHASE4_MODE` is `shadow`/`primary` AND `/ml/health` reports a ready active model. The heuristic extractor is always the user-visible default and the mandatory fallback. DOI resolution elsewhere uses a **DeterministicResolver** seam (see Phase 1).

#### Logic

1. Build a heuristic extraction result for every non-DOI-fast-path carrier. This remains the mandatory fallback path.
2. Load `ML_PHASE4_MODE`, `ML_PHASE4_PRIMARY_FRACTION`, and `ML_PHASE4_SHADOW_FRACTION`.
3. Query `/ml/health` once for the batch. If the service is unavailable, artifacts are not ready, or there is no active model version, the stage stays heuristic-only.
4. Deterministically route each citation using a normalized raw-input hash plus the active model version:
   - `heuristic`: no ML call
   - `shadow`: heuristic remains user-visible, ML runs only for diagnostics and `shadowDiff`
   - `primary`: ML becomes user-visible for hashed-in citations, heuristic remains the fallback
5. Only supported styles call `/ml/extract`: `apa7`, `mla9`, `vancouver`, `ieee`, `harvard-ctr`, `chicago-author-date`, `chicago-notes-bib`, and `unknown`.
   - `ama` and `acs` bypass ML and stay heuristic-only in Milestone 1. **Bypass is evaluated after** style is assigned on the carrier (so detection/split metadata does not route AMA/ACS into ML by mistake).
6. **Detection uncertainty**: If `carrier.detection.splitQualityFlag === 'low'` **and** `carrier.detection.confidence < 0.60`, Phase 4 may skip ML and stay heuristic-only for that citation (reduces bad extraction on bad boundaries).
7. ML calls are chunked to at most 128 items and sent as `{ texts, styles }`.
8. `/ml/extract` returns structured field predictions, field confidences, overall confidence, `styleUsed`, `uncertainFields`, model metadata, and optional `entities`.
9. Node maps those results into engine `FieldValue`s, preserves overwrite and lock rules, syncs uncertainty flags, and writes `extractionMeta`.
10. `shadowDiff` is computed against Phase 4 heuristic output only, not downstream normalized or enriched output.

#### Error handling (pipeline drain)

```typescript
try {
  const response = await mlClient.extract(batchTexts, batchStyles);
  // HTTP 200: full success
  // HTTP 207: partial success, null entries fall back to heuristic
  applyMlResultsWhereAvailable(response.results);
  applyHeuristicFallbackForNullOrErroredItems(response.errors);
} catch (error) {
  // Full batch failure after timeout/retry.
  applyHeuristicFallbackForWholeBatch(error);
  persistMlErrorInExtractionMeta(error);
}
```

#### Circuit breaker fallback

The ML client uses a 25-second timeout, one retry, and a one-second backoff. If the batch still fails, the stage records `mlError` in `extractionMeta` and degrades to heuristic extraction. Phase 6.5 keeps its current rules; this milestone does not introduce an LLM-primary extraction mode.

---

### Phase 5 — Author Disambiguation

**File**: `server/src/engine/phases/phase5AuthorDisambig.ts`
**Contract version**: 1
**Related**: Phase **5.8** Structural Family Router (`phase5_8StructuralFamilyRouter.ts`) runs immediately after author disambiguation in the core batch and on the DOI lane; it has no subsection of its own (see §6 module map).
**Input**: Raw `authors` field from Phase 4
**Output**: `FieldValue<CanonicalAuthor[]>` replaces raw author field

#### Logic

1. POST to `/ml/author-ner` (AffilGood NER: `SIRIS-Lab/affilgood-NER-multilingual`)
2. Handle formats: "Smith, J.", "J. Smith", "Smith John", CJK names (family-first), corporate authors
3. Corporate author detection: if no personal name pattern found → `{ isCorporate: true, literal: "..." }`
4. Model is lazy-loaded: not loaded at Python service startup, loaded on first request, kept warm

#### Circuit breaker fallback

Regex-based author parsing:
- Split on `,`, `&`, `and`
- Detect "Last, First" vs "First Last" pattern
- Handle "et al." truncation

---

### Phase 6 — Reference Type Classification

**File**: `server/src/engine/phases/phase6TypeClassify.ts`
**Contract version**: 1
**Input**: `ExtractedFields` + `StyleDetectionResult`
**Output**: `TypeClassificationResult`

#### Logic

1. POST to `/ml/classify-type` (fine-tuned DistilBERT multi-class)
2. Types: `article-journal`, `book`, `book-chapter`, `thesis`, `conference-paper`, `webpage`, `report`, `dataset`, `preprint`
3. If `confidence < 0.6`: set `isUnknown: true` → triggers LLM fallback in Phase 6.5

#### Circuit breaker fallback

Rule-based from field presence:
- Has `journal` + `volume` → `article-journal`
- Has `bookTitle` + `editors` → `book-chapter`
- Has `publisher`, no `journal` → `book`
- Has `conferenceTitle` → `conference-paper`
- Has `institution` + `thesisType` → `thesis`
- Has `url`, no `journal`/`publisher` → `webpage`
- Has `repository` → `preprint` or `dataset`

---

### Phase 6.5 — LLM Fallback (Mandatory Field Recovery)

**File**: `server/src/engine/phases/phase6_5LLMFallback.ts`
**Contract version**: 1
**Input**: `ReferenceCarrier[]` (only those flagged for fallback)
**Output**: Updated `ExtractedFields` with missing/low-confidence fields filled
**Status**: OPTIONAL — runs only when `ctx.options.llmFallback` is set (gated by `ENABLE_LLM_FALLBACK`, default on, and the execution policy's `llmFallback` mode; the fast lane disables it). Model id comes from `OPENAI_MODEL` (default `gpt-5.4-nano`); a per-tier repair budget applies (`LLM_REPAIR_BUDGET_FREE`/`LLM_REPAIR_BUDGET_PRO`).

> **Related — Phase 6.8 Shared Repair** (`phase6_8SharedRepair.ts`, no subsection of its own): a deterministic cross-field consistency repair that runs on **every** lane (including the inline fast lane and the DOI lane), independent of the LLM. See §6 module map.

#### Trigger Conditions (any one)

1. One or more mandatory fields for `type × style` schema are absent
2. One or more mandatory fields have `confidence < threshold` (see §7)
3. `type === "unknown"` after Phase 6
4. `style.isUnknown === true` after Phase 3

#### Overwrite Policy

```typescript
function canLLMOverwrite(existing: FieldValue<unknown>, llmRefConfidence: number): boolean {
  if (existing.source === 'admin_confirmed') return false;       // NEVER
  if (llmRefConfidence >= 0.85) return true;                     // fill all if highly confident
  return existing.value === null || existing.value === undefined; // otherwise, gaps only
}
```

#### Prompt Strategy

```
Given this citation: "{raw_reference}"
Detected type: {type}, Style: {style}

Return a JSON object with ALL bibliographic fields you can identify:
{"referenceConfidence": 0.0-1.0, "authors": [...], "title": "...", "year": ..., ...}

If you are very confident (>0.85) you have identified the exact reference, fill ALL fields.
If unsure, only fill: {missing_field_1}, {missing_field_2}
Return ONLY valid JSON, no explanation.
```

- Model: `gpt-5.4-nano`
- Max output tokens: 200
- Temperature: 0
- LLM-filled fields: confidence capped at `0.82`, tagged `source: 'llm_fallback'`
- If `referenceConfidence >= 0.85`: all returned fields applied (except admin-confirmed)
- If `referenceConfidence < 0.85`: only null/missing fields filled
- Cost tracking: `providerUsage.llmTokensUsed` incremented

#### Fallback Rate KPI

Track `llmFallbackRate = llmFallbacks / totalRefs` per job. Declining rate = engine improvement signal.

---

### Phase 7 — Normalization

**File**: `server/src/engine/phases/phase7Normalize.ts`
**Contract version**: 1
**Input**: Fully populated `ReferenceCarrier`
**Output**: Normalized `ExtractedFields` with `appliedRules[]` audit trail

#### Rules

1. **DOI normalization**: strip `https://doi.org/`, `https://dx.doi.org/`, `doi:` prefix → lowercase
2. **Page range normalization**: `1--5` → `1–5` (en-dash), strip `pp.`, `p.`
3. **Year normalization**: extract 4-digit year, handle "n.d.", "in press", date ranges
4. **Author name formatting**: normalize to `CanonicalAuthor` shape per output style
5. **Title case rules**: sentence case for APA, title case for MLA/Chicago, as-is for Vancouver
6. **URL normalization**: strip trailing periods, fix broken `http: //` spacing
7. **Edition normalization**: `2nd` → `2nd ed.`, `Third` → `3rd ed.`
8. **Journal abbreviation expansion**: use abbreviation map for normalization

All rules record `{ field, before, after, rule }` in `normalization_meta.appliedRules[]`.

**Ordering**: Phase 7 runs AFTER Phase 6.5 (LLM repair) — confirmed.

---

### Phase 8 — Enrichment (Confidence-Gated)

**File**: `server/src/engine/phases/phase8Enrich.ts` (class `Phase8Enrich`)
**Contract version**: 1
**Input**: Normalized `ReferenceCarrier`
**Output**: Enriched `ExtractedFields` + `EnrichmentResult`
**Status**: **Implemented** (was unbuilt when this section was written).

#### Gating (corrected)

Phase 8 only runs when **all** of the following hold:
- `FEATURE_LIVE_ENRICH` is on (default **OFF** — with it off, no live Crossref/OpenAlex/Semantic-Scholar traffic ever fires and production stays byte-identical);
- `ctx.options.enrich` is true (the convert route sets this only after the per-tier **enrichment allowance** passes — free tier is a lifetime ~10-reference trial, bulk is Pro-only; see `routes/convert.ts` + `runtime/guardrails.ts`); and
- the request resolved to an enrichment-capable profile (`core_parse_full_enrich` / `pro_overlay_enrich` / `current_runtime`).

#### Budget & cache (corrected)

- **Per-job provider budget**: `{ crossref: { maxCalls: 50 }, openalex: { maxCalls: 50 } }` — once a provider's budget is spent the remaining carriers skip that provider (cost-safety).
- **Persistent provider cache** is enabled whenever `FEATURE_LIVE_ENRICH` is on (even in `queue_first` Redis mode) so repeated DOIs do not re-bill.
- Concurrency is bounded by `PIPELINE_MAX_CONCURRENCY`; a per-stage time budget can short-circuit remaining carriers to `skipped`.

#### Providers

CrossRef + OpenAlex are the primary providers; **Semantic Scholar** is a last-resort provider (optional `SEMANTIC_SCHOLAR_API_KEY`). Provider results are memoized per normalized key within the batch.

#### Overwrite Policy

```typescript
// For each field from each provider:
for (const [fieldName, providerValue] of Object.entries(providerData)) {
  const existing = carrier.fields[fieldName];
  carrier.fields[fieldName] = applyEnrichmentField(
    existing, providerValue, providerConfidence, provider, 'phase8_enrichment'
  );
}

// applyEnrichmentField (from §3.8):
// - NEVER overwrites admin_confirmed
// - Fills null fields unconditionally
// - Overwrites model values ONLY IF provider confidence ≥ 0.85 AND > existing confidence
// - Preserves previousValue/previousSource for audit trail
```

#### Cache

- Check `provider_cache` table (or Redis if enabled) before API call
- Cache TTL: 24h for DOI lookups, 6h for title/author searches
- Record `cacheHits` count in `providerUsage`

#### Enrichment fields tagged `source: 'enrichment_crossref'` or `source: 'enrichment_openalex'`

Overwritten fields also visible in `enrichment_meta.fieldsOverwritten[]` for admin review.

#### Graceful degradation

If both providers fail/timeout: skip enrichment entirely, set `enrichment.status = 'skipped'`. Never block rendering.

---

### Phase 9 — Duplicate Clustering

**File**: `server/src/engine/phases/phase9Dedup.ts`
**Contract version**: 1
**Note**: dedup mode is set by the execution policy (`exact_canonical` on the fast lane, `full_local` on full lanes). Methods observed in output include `doi_exact`, `normalized_hash`, `canonical_work_key`, and `minhash_lsh`.
**Input**: `ReferenceCarrier[]` (full batch, including DOI fast-path refs that rejoin here)
**Output**: `ReferenceCarrier[]` with duplicate markers + `DuplicateGroup[]`

#### Algorithm

1. **MinHash signatures**: 128 permutations on normalized `title + first-author-family` tokens
2. **LSH band hashing**: for candidate pair retrieval (replaces O(n²) Levenshtein)
3. **Jaccard similarity threshold**: `0.85` for merge candidate
4. **DOI exact-match**: secondary signal — if two refs have the same DOI, they're duplicates regardless of text similarity

#### Non-destructive output

- Duplicates are grouped into `DuplicateGroup` with `primaryId` (highest-confidence member)
- Duplicate members get `status = 'duplicate'`, `duplicateOf = primaryId`
- Duplicate members get `publicStatus = 'needs_review'` (user decides merge)
- **No automatic merges.** The user or admin explicitly confirms.

---

### Phase 10 — Quality Scoring & Health Validation

**Files**: `server/src/engine/phases/phase10Health.ts` (health + diagnostic scoring), `server/src/engine/phases/phase10Score.ts` (rescoring helpers where present)
**Contract version**: 1
**Input**: Enriched, deduplicated `ReferenceCarrier`
**Output**: `ScoringResult` / health → sets `rawScore`, `scoreBucket`, initial `publicStatus`

#### Score Features

- **Field completeness**: % of mandatory fields present for detected `type × style`
- **Average field confidence**: mean confidence across all non-null fields
- **DOI resolved**: bonus if DOI present and verified
- **Format confidence**: combined split confidence (Phase 2) and style confidence (Phase 3)
- **Enrichment success**: bonus if provider data filled gaps
- **Mandatory fields missing**: each missing mandatory field is a penalty

#### ML Regression Model

- Calibrated regression model (Platt scaling) via `/ml/score`
- Input: feature vector from above
- Output: `rawScore` 0–100

#### Bucket Mapping

| rawScore | Internal Bucket | Initial publicStatus |
|----------|----------------|---------------------|
| 80–100   | A              | `ready`             |
| 60–79    | B              | `needs_review`      |
| 40–59    | C              | `needs_review`      |
| 0–39     | D              | `needs_action`      |

#### Override Rules

- Any reference with `splitMeta.flags` containing `'uncertain'`, `'too_short'`, or `'too_long'` → forced to `needs_action`
- Any reference with `type.isUnknown === true` after LLM fallback → forced to `needs_action`
- Any reference with `status === 'error'` → forced to `needs_action`
- Any reference with `status === 'duplicate'` → forced to `needs_review`
- **Detection / split quality** (when `carrier.detection` is set): low format confidence → `uncertain_detection` warning; `splitQualityFlag === 'low'` → `low_split_quality`; `sampled === true` → informational `sampled_detection`

#### Circuit breaker fallback

Rules-based scoring: field completeness % × 100, capped by mandatory field presence.

---

### Phase 11 — Authority Validation + Retraction Check

**File**: `server/src/engine/phases/phase11Authority.ts`
**Contract version**: 1
**Status**: OPTIONAL — runs only when `ctx.options.authorityValidation` is set (the execution policy enables it as `local_only` for full lanes, off for the fast lane).
**Input**: `rawScore`, `scoreBucket`, DOI
**Output**: `AuthorityResult` → sets `displayScore`, `displayBucket`, `authorityFlags`

#### Logic

```typescript
let displayScore = rawScore;
let displayBucket = scoreBucket;
const flags: AuthorityFlag[] = [];

// Retraction Watch check (2s timeout)
if (doi) {
  const retraction = await retractionWatch.check(doi, { timeout: 2000 }).catch(() => null);
  if (retraction?.retracted) {
    displayScore = Math.min(rawScore * 0.4, 30);
    displayBucket = 'D';
    flags.push({ type: 'retracted', source: 'retraction_watch', date: retraction.date });
  }
  if (retraction?.expressionOfConcern) {
    displayScore = Math.min(rawScore * 0.6, displayScore);
    flags.push({ type: 'expression_of_concern', source: 'retraction_watch', date: retraction.date });
  }
}

// CrossRef author verification
if (doi && enrichmentMeta?.crossrefHit) {
  const authorConflict = detectAuthorConflict(carrier.fields.authors, crossrefAuthors);
  if (authorConflict) {
    displayScore = Math.min(rawScore * 0.75, displayScore);
    flags.push({ type: 'author_conflict', source: 'crossref' });
  }
}
```

#### Storage

- Both `rawScore` and `displayScore` persisted in `citations` table
- `authorityFlags` stored as JSONB array
- `authority_checked_at` timestamp written
- `next_recheck_at` set to `now() + 30 days`

#### Re-check

> **⚠️ Superseded.** There is no `engine-v3-authority-recheck` BullMQ queue (BullMQ was removed). A background re-check is design intent only; any rolling re-check would run in-process or as an external scheduled task. The `next_recheck_at`/`authority_checked_at` columns still exist for future use.

#### Timeout handling

If Retraction Watch is unavailable (timeout, error): skip authority check, set `authority_checked_at = null`, `flags = []`. Authority failures never fail the batch.

---

### Phase 12 — Rendering + Export

**File**: `server/src/engine/phases/phase12Render.ts`
**Contract version**: 2 (see source for format-scoring path integration)
**Input**: Fully scored `ReferenceCarrier`
**Output**: `RenderedResult` + export artifacts

#### Detection-aware render fallback

If `carrier.detection.confidence < 0.60` **or** `carrier.detection.splitQualityFlag !== 'ok'`, render assessment may emit `render_style_fallback` even when the resolved style is in the guaranteed set—so visibly “safe” styles still get a review signal when upstream detection/split was weak.

#### Rendering Engine (corrected — native renderers, not citeproc-js)

> **⚠️ Superseded.** Rendering is done by **purpose-built native renderers in `phase12Render.ts`** (class `Phase12Render`), not citeproc-js / CSL. There are **9 first-class style renderers**, each a real renderer (no APA fallback):
> `apa7`, `mla9`, `chicago-author-date`, **`chicago-notes-bib`**, `vancouver`, `ieee`, `harvard-ctr`, **`ama`**, **`acs`** (plus `unknown`/`auto` resolution). AMA (`renderAma`), ACS (`renderAcs`), and Chicago-notes-bib (`renderChicagoNotesBib`) are dedicated functions in `phase12Render.ts`, NOT APA stand-ins. The CSL-JSON mapping in §13.7 describes the original citeproc design and is **not** how rendering currently works.
>
> Output is segmented (`RenderSegment[]`) so styling (italics/quotes) and assertion checks apply per element. The "guaranteed style" concept (the four acceptance-gated styles) still exists for testing, but all nine styles render natively.

#### Assertion Checking

Post-render validation that the output matches style expectations:
- Author format correct for style
- Year position correct
- Italics/quotes on correct elements
- DOI format correct
- Returns `assertionSummary { total, passed, failed }`

#### Export Generation

| Format | Generation | Trigger |
|--------|-----------|---------|
| TXT    | Eager     | Generated at job completion, stored in `export_artifacts` |
| BibTeX | Lazy      | Generated on first `GET /v1/export/:jobId/bib` request |
| RIS    | Lazy      | Generated on first `GET /v1/export/:jobId/ris` request |
| CSV    | Lazy      | Generated on first `GET /v1/export/:jobId/csv` request |
| DOCX   | Lazy      | Generated on first `GET /v1/export/:jobId/docx` request |

Lazy exports are generated **on-demand in-process** (`ensureJobExport` in `jobs/runtime.ts` → `buildExportContent`), then cached (inline, with optional R2 offload via `EXPORT_R2_OFFLOAD_ENABLED`) and served on subsequent requests. There is **no `engine-v3-export` BullMQ queue** — that line is superseded.

#### UI Metadata

- `publicStatus` badge: ✅ Ready, ⚠️ Needs Review, 🔴 Needs Action
- If `authorityFlags.length > 0`: inline warning badge
- If `rawScore ≠ displayScore`: show "Score adjusted: {reason}" disclosure
- If legacy tier: show "⚠️ Legacy record — provenance unverified" label

---

### Phase 13 — User Corrections + Regression Capture + Active Learning

**File**: `server/src/engine/phases/phase13FeedbackLoop.ts` (exports `phase13FeedbackLoop` + `applyCertifiedApprovedTruthOverlays`)
**Contract version**: 1
**Status**: OPTIONAL — the full feedback loop runs only when `ctx.options.feedbackLoop` is set. When it is off, the pipeline still applies **certified approved-truth overlays** (a reduced step) unless the run is evidence-only. The Report/Correction *intake* flows below are HTTP routes, independent of whether the in-pipeline feedback stage runs.

#### Flow 1 — Report Button (`POST /v1/reports`)

User-facing modal captures:
- `failureCategory`: `wrong_field` | `missing_field` | `wrong_format` | `wrong_type` | `false_positive`
- Field highlight: user clicks the specific wrong field
- `userNote`: optional free-text with correct value (500 char max)

System action:
1. Create `citation_reports` record with `status: 'pending'`
2. Snapshot `engine_snapshot` (pipeline version, stages run, fallbacks, quality flags)
3. Compute `stage_blame` (which phase likely caused the issue)
4. Queue to `active_learning_queue` with `source = 'user_report'`

#### Flow 2 — Silent Edit (`POST /v1/corrections`)

User edits a field in the UI → silent event fires:
1. Create `user_corrections` record with `status: 'pending'`
2. Create `citation_versions` entry (audit trail: version_num, old fields, new fields)
3. Queue to `active_learning_queue` with `source = 'user_edit'`
4. User sees only a success toast. No review UI shown.

#### Correction Status Lifecycle

```
pending → consensus_candidate (if multiple users submit same correction)
        → approved (admin approves)
        → rejected (admin rejects)
        → auto_applied (future: mature automation)
```

#### Admin Review Queue — 3 Maturity Levels

| Level | Trigger | Action |
|-------|---------|--------|
| Manual (launch) | All corrections | Admin reviews every correction |
| Semi-auto (~500 corrections) | Two independent users correct same field to same value | Auto-promote to `consensus_candidate`, admin confirms |
| Fully auto (high volume) | Model confidence > 0.95 on the correction | Auto-apply, passive monitoring |

#### Correction Hierarchy (from §1.1)

```
admin_confirmed > provider_enriched > model_extracted > pending_user_correction > regex_fallback > empty
```

- **Pending user corrections** are suggestions. They can be overwritten by stronger model/provider evidence during re-processing.
- **Admin-confirmed corrections** are FINAL. They can never be overwritten by enrichment, LLM, or pipeline phases.
- **When admin approves a correction**: field source changes from `user_correction` to `admin_confirmed`, and the approved value is written to `approved_truth` for regression.

#### Regression Capture Rule

Any shared-stage or tuning change must rerun the **full real-world regression corpus**, not just the batch that exposed the issue. Publish outputs to `docs/test-results/`.

---

## 7. Mandatory Field Schemas

All 54 type × style combinations. Defines what Phase 6.5 targets and Phase 10 scores against.

```typescript
// server/engine/mandatory-fields.ts

export interface FieldSchema {
  mandatory: (keyof ExtractedFields)[];
  preferred: (keyof ExtractedFields)[];
  optional: (keyof ExtractedFields)[];
}

export const FIELD_SCHEMAS: Record<string, FieldSchema> = {

  // ── article-journal ──────────────────────────────────────────
  'article-journal:apa7': {
    mandatory: ['authors', 'year', 'title', 'journal', 'volume', 'issue', 'pages'],
    preferred: ['doi', 'url'],
    optional:  ['articleNumber', 'database'],
  },
  'article-journal:mla9': {
    mandatory: ['authors', 'title', 'journal', 'volume', 'issue', 'year', 'pages'],
    preferred: ['doi', 'url'],
    optional:  [],
  },
  'article-journal:chicago-author-date': {
    mandatory: ['authors', 'year', 'title', 'journal', 'volume', 'issue', 'pages'],
    preferred: ['doi', 'url'],
    optional:  [],
  },
  'article-journal:chicago-notes-bib': {
    mandatory: ['authors', 'title', 'journal', 'volume', 'issue', 'year', 'pages'],
    preferred: ['doi', 'url'],
    optional:  [],
  },
  'article-journal:vancouver': {
    mandatory: ['authors', 'title', 'journal', 'year', 'volume', 'pages'],
    preferred: ['doi', 'issue'],
    optional:  ['url'],
  },
  'article-journal:ieee': {
    mandatory: ['authors', 'title', 'journal', 'volume', 'issue', 'pages', 'year'],
    preferred: ['doi'],
    optional:  ['url', 'articleNumber'],
  },
  'article-journal:harvard-ctr': {
    mandatory: ['authors', 'year', 'title', 'journal', 'volume', 'issue', 'pages'],
    preferred: ['doi', 'url'],
    optional:  [],
  },
  'article-journal:ama': {
    mandatory: ['authors', 'title', 'journal', 'year', 'volume', 'issue', 'pages'],
    preferred: ['doi'],
    optional:  ['url'],
  },
  'article-journal:acs': {
    mandatory: ['authors', 'title', 'journal', 'year', 'volume', 'issue', 'pages'],
    preferred: ['doi'],
    optional:  ['url'],
  },

  // ── book ─────────────────────────────────────────────────────
  'book:apa7': {
    mandatory: ['authors', 'year', 'title', 'publisher'],
    preferred: ['doi', 'edition', 'placeOfPublication'],
    optional:  ['url', 'editors'],
  },
  'book:mla9': {
    mandatory: ['authors', 'title', 'publisher', 'year'],
    preferred: ['edition', 'doi'],
    optional:  ['url', 'placeOfPublication'],
  },
  'book:chicago-author-date': {
    mandatory: ['authors', 'year', 'title', 'placeOfPublication', 'publisher'],
    preferred: ['edition', 'doi'],
    optional:  ['url'],
  },
  'book:chicago-notes-bib': {
    mandatory: ['authors', 'title', 'placeOfPublication', 'publisher', 'year'],
    preferred: ['edition', 'doi'],
    optional:  ['url'],
  },
  'book:vancouver': {
    mandatory: ['authors', 'title', 'placeOfPublication', 'publisher', 'year'],
    preferred: ['edition'],
    optional:  ['doi', 'url'],
  },
  'book:ieee': {
    mandatory: ['authors', 'title', 'publisher', 'year'],
    preferred: ['edition', 'placeOfPublication'],
    optional:  ['doi', 'url'],
  },
  'book:harvard-ctr': {
    mandatory: ['authors', 'year', 'title', 'placeOfPublication', 'publisher'],
    preferred: ['edition', 'doi'],
    optional:  ['url'],
  },
  'book:ama': {
    mandatory: ['authors', 'title', 'placeOfPublication', 'publisher', 'year'],
    preferred: ['edition'],
    optional:  ['doi', 'url'],
  },
  'book:acs': {
    mandatory: ['authors', 'title', 'publisher', 'year'],
    preferred: ['edition'],
    optional:  ['doi', 'url'],
  },

  // ── book-chapter ─────────────────────────────────────────────
  'book-chapter:apa7': {
    mandatory: ['authors', 'year', 'title', 'editors', 'bookTitle', 'pages', 'publisher'],
    preferred: ['doi', 'edition', 'placeOfPublication'],
    optional:  ['url'],
  },
  'book-chapter:mla9': {
    mandatory: ['authors', 'title', 'bookTitle', 'editors', 'publisher', 'year', 'pages'],
    preferred: ['doi'],
    optional:  ['edition', 'placeOfPublication', 'url'],
  },
  'book-chapter:chicago-author-date': {
    mandatory: ['authors', 'year', 'title', 'editors', 'bookTitle', 'pages', 'placeOfPublication', 'publisher'],
    preferred: ['doi'],
    optional:  ['edition', 'url'],
  },
  'book-chapter:chicago-notes-bib': {
    mandatory: ['authors', 'title', 'editors', 'bookTitle', 'pages', 'placeOfPublication', 'publisher', 'year'],
    preferred: ['doi'],
    optional:  ['edition', 'url'],
  },
  'book-chapter:vancouver': {
    mandatory: ['authors', 'title', 'editors', 'bookTitle', 'placeOfPublication', 'publisher', 'year', 'pages'],
    preferred: [],
    optional:  ['doi', 'url', 'edition'],
  },
  'book-chapter:ieee': {
    mandatory: ['authors', 'title', 'bookTitle', 'publisher', 'year', 'pages'],
    preferred: ['editors', 'doi'],
    optional:  ['edition', 'placeOfPublication', 'url'],
  },
  'book-chapter:harvard-ctr': {
    mandatory: ['authors', 'year', 'title', 'editors', 'bookTitle', 'placeOfPublication', 'publisher', 'pages'],
    preferred: ['doi'],
    optional:  ['edition', 'url'],
  },
  'book-chapter:ama': {
    mandatory: ['authors', 'title', 'editors', 'bookTitle', 'placeOfPublication', 'publisher', 'year', 'pages'],
    preferred: [],
    optional:  ['doi', 'url', 'edition'],
  },
  'book-chapter:acs': {
    mandatory: ['authors', 'title', 'editors', 'bookTitle', 'publisher', 'year', 'pages'],
    preferred: ['doi'],
    optional:  ['edition', 'url'],
  },

  // ── thesis ───────────────────────────────────────────────────
  'thesis:apa7': {
    mandatory: ['authors', 'year', 'title', 'institution', 'thesisType'],
    preferred: ['url', 'database'],
    optional:  ['doi'],
  },
  'thesis:mla9': {
    mandatory: ['authors', 'title', 'institution', 'year', 'thesisType'],
    preferred: ['url'],
    optional:  ['doi', 'database'],
  },
  'thesis:chicago-author-date': {
    mandatory: ['authors', 'year', 'title', 'thesisType', 'institution'],
    preferred: ['url'],
    optional:  ['doi'],
  },
  'thesis:chicago-notes-bib': {
    mandatory: ['authors', 'title', 'thesisType', 'institution', 'year'],
    preferred: ['url'],
    optional:  ['doi'],
  },
  'thesis:vancouver': {
    mandatory: ['authors', 'title', 'thesisType', 'institution', 'year'],
    preferred: [],
    optional:  ['url', 'doi'],
  },
  'thesis:ieee': {
    mandatory: ['authors', 'title', 'thesisType', 'institution', 'year'],
    preferred: [],
    optional:  ['url', 'doi'],
  },
  'thesis:harvard-ctr': {
    mandatory: ['authors', 'year', 'title', 'thesisType', 'institution'],
    preferred: ['url'],
    optional:  ['doi'],
  },
  'thesis:ama': {
    mandatory: ['authors', 'title', 'thesisType', 'institution', 'year'],
    preferred: [],
    optional:  ['url', 'doi'],
  },
  'thesis:acs': {
    mandatory: ['authors', 'title', 'thesisType', 'institution', 'year'],
    preferred: [],
    optional:  ['url', 'doi'],
  },

  // ── conference-paper ─────────────────────────────────────────
  'conference-paper:apa7': {
    mandatory: ['authors', 'year', 'title', 'conferenceTitle'],
    preferred: ['pages', 'doi', 'placeOfPublication'],
    optional:  ['url', 'publisher'],
  },
  'conference-paper:mla9': {
    mandatory: ['authors', 'title', 'conferenceTitle', 'year'],
    preferred: ['pages', 'doi', 'placeOfPublication'],
    optional:  ['url', 'publisher'],
  },
  'conference-paper:chicago-author-date': {
    mandatory: ['authors', 'year', 'title', 'conferenceTitle'],
    preferred: ['pages', 'placeOfPublication', 'doi'],
    optional:  ['url', 'publisher'],
  },
  'conference-paper:chicago-notes-bib': {
    mandatory: ['authors', 'title', 'conferenceTitle', 'year'],
    preferred: ['pages', 'placeOfPublication', 'doi'],
    optional:  ['url', 'publisher'],
  },
  'conference-paper:vancouver': {
    mandatory: ['authors', 'title', 'conferenceTitle', 'year'],
    preferred: ['pages', 'placeOfPublication'],
    optional:  ['doi', 'url', 'publisher'],
  },
  'conference-paper:ieee': {
    mandatory: ['authors', 'title', 'conferenceTitle', 'year'],
    preferred: ['pages', 'doi'],
    optional:  ['placeOfPublication', 'url', 'publisher'],
  },
  'conference-paper:harvard-ctr': {
    mandatory: ['authors', 'year', 'title', 'conferenceTitle'],
    preferred: ['pages', 'placeOfPublication', 'doi'],
    optional:  ['url', 'publisher'],
  },
  'conference-paper:ama': {
    mandatory: ['authors', 'title', 'conferenceTitle', 'year'],
    preferred: ['pages', 'placeOfPublication'],
    optional:  ['doi', 'url'],
  },
  'conference-paper:acs': {
    mandatory: ['authors', 'title', 'conferenceTitle', 'year'],
    preferred: ['pages', 'doi'],
    optional:  ['placeOfPublication', 'url'],
  },

  // ── webpage ──────────────────────────────────────────────────
  'webpage:apa7': {
    mandatory: ['authors', 'year', 'title', 'url', 'accessedDate'],
    preferred: ['siteName'],
    optional:  [],
  },
  'webpage:mla9': {
    mandatory: ['authors', 'title', 'siteName', 'url', 'accessedDate'],
    preferred: ['year'],
    optional:  [],
  },
  'webpage:chicago-author-date': {
    mandatory: ['authors', 'year', 'title', 'url', 'accessedDate'],
    preferred: ['siteName'],
    optional:  [],
  },
  'webpage:chicago-notes-bib': {
    mandatory: ['authors', 'title', 'url', 'accessedDate'],
    preferred: ['siteName', 'year'],
    optional:  [],
  },
  'webpage:vancouver': {
    mandatory: ['title', 'url', 'accessedDate'],
    preferred: ['authors', 'year'],
    optional:  ['siteName'],
  },
  'webpage:ieee': {
    mandatory: ['authors', 'title', 'url', 'accessedDate'],
    preferred: ['year'],
    optional:  ['siteName'],
  },
  'webpage:harvard-ctr': {
    mandatory: ['authors', 'year', 'title', 'url', 'accessedDate'],
    preferred: ['siteName'],
    optional:  [],
  },
  'webpage:ama': {
    mandatory: ['title', 'url', 'accessedDate'],
    preferred: ['authors', 'year'],
    optional:  ['siteName'],
  },
  'webpage:acs': {
    mandatory: ['title', 'url', 'accessedDate'],
    preferred: ['authors', 'year'],
    optional:  [],
  },

  // ── report ───────────────────────────────────────────────────
  'report:apa7': {
    mandatory: ['authors', 'year', 'title', 'institution'],
    preferred: ['reportNumber', 'url', 'doi'],
    optional:  [],
  },
  'report:mla9': {
    mandatory: ['authors', 'title', 'institution', 'year'],
    preferred: ['reportNumber', 'url'],
    optional:  ['doi'],
  },
  'report:chicago-author-date': {
    mandatory: ['authors', 'year', 'title', 'institution'],
    preferred: ['reportNumber', 'url'],
    optional:  ['doi'],
  },
  'report:chicago-notes-bib': {
    mandatory: ['authors', 'title', 'institution', 'year'],
    preferred: ['reportNumber', 'url'],
    optional:  ['doi'],
  },
  'report:vancouver': {
    mandatory: ['authors', 'title', 'institution', 'year'],
    preferred: ['reportNumber'],
    optional:  ['url', 'doi'],
  },
  'report:ieee': {
    mandatory: ['authors', 'title', 'institution', 'year'],
    preferred: ['reportNumber'],
    optional:  ['url', 'doi'],
  },
  'report:harvard-ctr': {
    mandatory: ['authors', 'year', 'title', 'institution'],
    preferred: ['reportNumber', 'url'],
    optional:  ['doi'],
  },
  'report:ama': {
    mandatory: ['authors', 'title', 'institution', 'year'],
    preferred: ['reportNumber'],
    optional:  ['url', 'doi'],
  },
  'report:acs': {
    mandatory: ['authors', 'title', 'institution', 'year'],
    preferred: ['reportNumber'],
    optional:  ['url', 'doi'],
  },

  // ── dataset ──────────────────────────────────────────────────
  'dataset:apa7': {
    mandatory: ['authors', 'year', 'title', 'repository'],
    preferred: ['doi', 'url', 'edition'],
    optional:  [],
  },
  'dataset:mla9': {
    mandatory: ['authors', 'title', 'repository', 'year'],
    preferred: ['doi', 'url'],
    optional:  [],
  },
  'dataset:chicago-author-date': {
    mandatory: ['authors', 'year', 'title', 'repository'],
    preferred: ['doi', 'url'],
    optional:  [],
  },
  'dataset:chicago-notes-bib': {
    mandatory: ['authors', 'title', 'repository', 'year'],
    preferred: ['doi', 'url'],
    optional:  [],
  },
  'dataset:vancouver': {
    mandatory: ['authors', 'title', 'repository', 'year'],
    preferred: ['doi'],
    optional:  ['url'],
  },
  'dataset:ieee': {
    mandatory: ['authors', 'title', 'repository', 'year'],
    preferred: ['doi'],
    optional:  ['url'],
  },
  'dataset:harvard-ctr': {
    mandatory: ['authors', 'year', 'title', 'repository'],
    preferred: ['doi', 'url'],
    optional:  [],
  },
  'dataset:ama': {
    mandatory: ['authors', 'title', 'repository', 'year'],
    preferred: ['doi'],
    optional:  ['url'],
  },
  'dataset:acs': {
    mandatory: ['authors', 'title', 'repository', 'year'],
    preferred: ['doi'],
    optional:  ['url'],
  },

  // ── preprint ─────────────────────────────────────────────────
  'preprint:apa7': {
    mandatory: ['authors', 'year', 'title', 'repository'],
    preferred: ['doi', 'url'],
    optional:  [],
  },
  'preprint:mla9': {
    mandatory: ['authors', 'title', 'repository', 'year'],
    preferred: ['doi', 'url'],
    optional:  [],
  },
  'preprint:chicago-author-date': {
    mandatory: ['authors', 'year', 'title', 'repository'],
    preferred: ['doi', 'url'],
    optional:  [],
  },
  'preprint:chicago-notes-bib': {
    mandatory: ['authors', 'title', 'repository', 'year'],
    preferred: ['doi', 'url'],
    optional:  [],
  },
  'preprint:vancouver': {
    mandatory: ['authors', 'title', 'repository', 'year'],
    preferred: ['doi'],
    optional:  ['url'],
  },
  'preprint:ieee': {
    mandatory: ['authors', 'title', 'repository', 'year'],
    preferred: ['doi'],
    optional:  ['url'],
  },
  'preprint:harvard-ctr': {
    mandatory: ['authors', 'year', 'title', 'repository'],
    preferred: ['doi', 'url'],
    optional:  [],
  },
  'preprint:ama': {
    mandatory: ['authors', 'title', 'repository', 'year'],
    preferred: ['doi'],
    optional:  ['url'],
  },
  'preprint:acs': {
    mandatory: ['authors', 'title', 'repository', 'year'],
    preferred: ['doi'],
    optional:  ['url'],
  },

  // ── unknown (fallback) ──────────────────────────────────────
  'unknown:apa7':                { mandatory: ['authors', 'title', 'year'], preferred: ['doi'], optional: [] },
  'unknown:mla9':                { mandatory: ['authors', 'title', 'year'], preferred: ['doi'], optional: [] },
  'unknown:chicago-author-date': { mandatory: ['authors', 'title', 'year'], preferred: ['doi'], optional: [] },
  'unknown:chicago-notes-bib':   { mandatory: ['authors', 'title', 'year'], preferred: ['doi'], optional: [] },
  'unknown:vancouver':           { mandatory: ['authors', 'title', 'year'], preferred: ['doi'], optional: [] },
  'unknown:ieee':                { mandatory: ['authors', 'title', 'year'], preferred: ['doi'], optional: [] },
  'unknown:harvard-ctr':         { mandatory: ['authors', 'title', 'year'], preferred: ['doi'], optional: [] },
  'unknown:ama':                 { mandatory: ['authors', 'title', 'year'], preferred: ['doi'], optional: [] },
  'unknown:acs':                 { mandatory: ['authors', 'title', 'year'], preferred: ['doi'], optional: [] },
};

// Per-field confidence thresholds (below → uncertain: true → LLM fallback candidate)
export const FIELD_CONFIDENCE_THRESHOLDS: Partial<Record<keyof ExtractedFields, number>> = {
  authors: 0.75,
  title:   0.80,
  year:    0.90,
  doi:     0.95,
  journal: 0.70,
  volume:  0.65,
  issue:   0.65,
  pages:   0.65,
  publisher: 0.70,
  conferenceTitle: 0.70,
  bookTitle: 0.70,
  institution: 0.70,
  thesisType: 0.80,
};

// Helper: look up schema for type×style combo
export function getFieldSchema(type: ReferenceType, style: CitationStyle): FieldSchema {
  const key = `${type}:${style}`;
  return FIELD_SCHEMAS[key] ?? FIELD_SCHEMAS[`unknown:${style}`] ?? FIELD_SCHEMAS['unknown:apa7'];
}
```

---

## 8. Python ML Microservice

### 8.0 Implementation Update (2026-04-02)

The Phase 4 runtime contract is now integrated into the engine, with Node orchestrating rollout and persistence while `ml-service` remains a separate inference process.

Current implemented runtime behavior:

- Phase 4 is the only stage using the new rollout contract in this milestone.
- Node uses a shared pipeline dependency factory so sync convert, async jobs, admin reprocess, queue workers, and regression runs all execute the same ML-capable Phase 3–6 stack.
- **`FEATURE_SCORED_DETECTOR`** (Node Phase 1): set to `true` or `1` in the environment to enable the scored multi-candidate format detector; default is off. Validated in `config.ts`; Phase 1 reads `process.env` at runtime for testability. When on, `formatConfidence` reflects **effective** confidence (includes sampled discount where applicable).
- `ML_PHASE4_MODE` supports `heuristic`, `shadow`, and `primary`.
- `ML_PHASE4_PRIMARY_FRACTION` and `ML_PHASE4_SHADOW_FRACTION` are deterministic per citation using a normalized raw-input hash plus the active model version.
- `ama` and `acs` bypass `/ml/extract` and remain heuristic-only.
- `/ml/extract` is batched, capped at 128 items per request, accepts `{ texts, styles }`, and returns:
  - HTTP `200` for full success
  - HTTP `207` for partial success
  - `{ results: Array<ExtractResult | null>, errors?: [{ index, code, message? }] }`
- Per-item extract results use engine field keys directly and include:
  - `fields`
  - `fieldConfidences`
  - `overallConfidence`
  - `modelVersion`
  - `featureVersion`
  - `styleUsed`
  - `uncertainFields`
  - optional `entities`
- `/ml/health` now reports:
  - `status`
  - `activeModelVersion`
  - `featureVersion`
  - `artifactsReady`
  - `lastSuccessfulInferenceAt`
- Each processed citation now carries `extractionMeta`, and every completed run appends a row to `citation_extraction_history`.
- In `shadow`, heuristic output remains visible and `shadowDiff` is stored against the ML result.
- In `primary`, ML output is visible for hashed-in citations; ML failures fall back to heuristic without failing the batch.

### 8.1 Project Structure

```
ml-service/
├── app/
│   ├── main.py             # FastAPI entry point and runtime contract
│   ├── models/
│   │   └── loader.py       # Runtime metadata / artifact loader
│   └── parsers/
│       ├── pdf_parser.py   # PDF ingest helper
│       └── docx_parser.py  # DOCX ingest helper
├── training/               # planned offline harvest/train/eval/promote subsystem
└── requirements.txt
```

### 8.2 Endpoints

```
POST /ml/detect-style
  Request:  { texts: string[] }
  Response: [{ primary: { style, confidence }, secondary: { style, confidence } | null }]

POST /ml/extract
  Request:  { texts: string[], styles: string[] }
  Constraints:
    - texts.length === styles.length
    - max 128 items per request
  Response 200:
    {
      results: [{
        fields: { ...engine field keys... },
        fieldConfidences: { [field]: number },
        overallConfidence: number,
        modelVersion: string,
        featureVersion: string,
        styleUsed: string,
        uncertainFields: string[],
        entities?: object[]
      }]
    }
  Response 207:
    {
      results: [null | ExtractResult, ...],
      errors: [{ index, code, message? }]
    }

POST /ml/author-ner
  Request:  { texts: string[] }
  Response: { predictions: [{ authors: [{family, given, initials, isCorporate, confidence}] }] }

POST /ml/classify-type
  Request:  { texts: string[], extracted_fields: object[] }
  Response: { predictions: [{ type: string, confidence: float }] }

POST /ml/score
  Request:  { features: [{ fieldCompleteness, avgConfidence, doiResolved, ... }] }
  Response: { scores: float[] }

POST /ml/ingest-pdf
  Request:  multipart file
  Response: { rawText: string, pageCount: number, metadata: { hasColumns, hasFootnotes } }

POST /ml/ingest-docx
  Request:  multipart file
  Response: { rawText: string, metadata: { hasBibliography, sectionHeaders } }

GET /ml/health
  Response: {
    status: 'ok' | 'degraded' | 'unavailable',
    activeModelVersion: string | null,
    featureVersion: string | null,
    artifactsReady: boolean,
    lastSuccessfulInferenceAt: string | null
  }
```

### 8.3 Runtime Notes

- The current runtime contract is integrated only for Phase 4.
- Node decides whether ML is used at all; Python does not own rollout.
- `ama` and `acs` never call `/ml/extract` in this milestone.
- `unknown` style is allowed and should return best-effort lower-confidence output.
- The Node client uses a 25-second timeout, one retry, and a one-second backoff for `/ml/extract`.
- Larger conversion batches are split into sequential Phase 4 ML calls of at most 128 citations each.
- Every applied Phase 4 result writes `extractionMeta` on the citation; completed runs also append `citation_extraction_history`.

### 8.4 Artifact Activation and Rollout

- Runtime activation is explicit: update the active artifact pointer, then restart `ml-service`.
- `/ml/health` reports the model version actually loaded in memory, not merely what exists on disk.
- Rollout is controlled entirely from Node:
  - `ML_PHASE4_MODE = heuristic | shadow | primary`
  - `ML_PHASE4_PRIMARY_FRACTION`
  - `ML_PHASE4_SHADOW_FRACTION`
- `shadow` stores `shadowDiff` while keeping heuristic output visible.
- `primary` makes ML user-visible only for hashed-in citations and falls back to heuristic on item-level or batch-level failure.

---

## 9. Testing Strategy

### 9.1 Directory Structure

```
tests/
├── unit/
│   ├── phase1-ingestion.test.ts
│   ├── phase2-aggregation.test.ts
│   ├── phase2-splitting.test.ts
│   ├── phase3-style-detection.test.ts
│   ├── phase4-extraction.test.ts
│   ├── phase5-author-disambiguation.test.ts
│   ├── phase6-type-classification.test.ts
│   ├── phase6.5-llm-fallback.test.ts
│   ├── phase7-normalization.test.ts
│   ├── phase8-enrichment.test.ts
│   ├── phase9-deduplication.test.ts
│   ├── phase10-scoring.test.ts
│   ├── phase11-authority.test.ts
│   ├── phase12-rendering.test.ts
│   ├── phase13-corrections.test.ts
│   ├── overwrite-policy.test.ts
│   └── mandatory-fields.test.ts
├── integration/
│   ├── full-batch-conversion.test.ts
│   ├── inspect-convert-count-parity.test.ts       ← CRITICAL
│   ├── doi-list-pipeline.test.ts
│   ├── doi-fast-path.test.ts
│   ├── file-upload-async.test.ts
│   ├── enrichment-overwrite-guard.test.ts          ← CRITICAL
│   ├── llm-overwrite-guard.test.ts                 ← CRITICAL
│   ├── admin-confirmed-protection.test.ts          ← CRITICAL
│   ├── partial-success-envelope.test.ts
│   ├── circuit-breaker-fallback.test.ts
│   └── batch-parallel-processing.test.ts
├── regression/
│   ├── suites/
│   │   ├── raw-unstructured-paste.json
│   │   ├── pdf-copy-artifacts.json
│   │   ├── numbered-multiline-refs.json
│   │   ├── doi-lists.json
│   │   ├── mixed-style-batches.json
│   │   ├── duplicate-heavy-lists.json
│   │   ├── corporate-authors.json
│   │   ├── cjk-authors.json
│   │   └── messy-references.json
│   └── runner.ts
├── fixtures/
│   └── references/                                 ← sample inputs per format/style
└── output/                                         ← micro-test debug output
```

### 9.2 Regression Fixture Schema

```typescript
interface RegressionFixture {
  id: string;
  suiteName: string;
  verbatimInput: string;              // exact input, never paraphrased
  expectedOutput: {
    fields?: Partial<ExtractedFields>;
    referenceType?: ReferenceType;
    detectedStyle?: CitationStyle;
    rendered?: string;
    publicStatus?: PublicStatus;
    countAudit?: Partial<CountAudit>;
  };
  failureMode: string;                 // e.g. 'multiline_split_drop' | 'enrichment_overwrite'
  provenance: string;                  // e.g. 'user_report_2026_03' | 'manual'
  isActive: boolean;
}
```

### 9.3 v1 Acceptance Gates

A v1 release is **blocked** unless ALL of the following pass:

| # | Gate | Test File |
|---|------|-----------|
| 1 | **Inspect/convert count parity**: `countAudit.delta === 0` across all regression inputs | `inspect-convert-count-parity.test.ts` |
| 2 | **No silent drops**: `countAudit.droppedCount === 0` across all inputs | `phase2-splitting.test.ts` |
| 3 | **Duplicate surfacing**: all fixtures with duplicates show `DuplicateGroup[]`, no auto-merges | `phase9-deduplication.test.ts` |
| 4 | **Authority isolation**: authority failures in individual citations do NOT fail the batch | `phase11-authority.test.ts` |
| 5 | **Enrichment non-overwrite**: no test shows a model-extracted value overwritten by enrichment when provider confidence < 0.85 | `enrichment-overwrite-guard.test.ts` |
| 6 | **Admin protection**: no test shows an `admin_confirmed` field overwritten by any phase | `admin-confirmed-protection.test.ts` |
| 7 | **LLM overwrite guard**: LLM only fills null fields when `referenceConfidence < 0.85` | `llm-overwrite-guard.test.ts` |
| 8 | **Guaranteed styles**: APA7, MLA9, Chicago Author-Date, Vancouver all render without errors on regression corpus | `phase12-rendering.test.ts` |
| 9 | **Partial success**: batch with mixed success/failure returns all refs with correct status | `partial-success-envelope.test.ts` |

### 9.4 Regression Rule

> Any shared-stage change, ML tuning change, or overwrite-policy change must rerun the **full real-world regression corpus**, not just the batch that exposed the issue. Publish suite outputs to `docs/test-results/` with run date, pipeline_major version, and pass/fail counts.

---

## 10. Build Order

> **⚠️ Historical plan.** This sprint plan is the original build sequence and is kept for context. Where it lists **"Redis + BullMQ queue setup / worker shell"** (Sprint 1), **"BullMQ async job wiring (pipeline queue)"** (Sprint 4), and **"lazy export … via export queue"** (Sprint 4), those were superseded: the async path is **in-process `queueMicrotask`** and lazy exports are generated **on-demand in-process** (see §4, §6 Phase 12). Redis is optional, not a day-1 dependency. The pipeline also grew from 13 to **17 modules** (§6). Treat unchecked boxes as plan intent, not current status.

### Sprint 1 (Weeks 1–2) — Foundation + Phases 1–2

**Goal**: Repo setup, infrastructure, and the first working endpoint (`/v1/inspect`).

- [ ] Repo structure: `server/`, `ai-services/`, `tests/`, `docs/test-results/`
- [ ] Fastify app shell: health endpoint, error handling, CORS
- [ ] Drizzle schema + initial migration (all tables from §2)
- [ ] Redis connection + BullMQ queue setup (worker shell)
- [ ] Auth middleware (session + API key dual auth)
- [ ] Rate limiting middleware
- [ ] Cloudflare R2 client (file storage abstraction)
- [ ] Phase 1: Ingestion + Input Profiling (text + doi_list only, no file upload yet)
- [ ] Phase 2: Block Aggregation + Splitting + CountAudit
- [ ] `/v1/inspect` route wired to shared Phase 1+2 logic
- [ ] Unit tests: Phase 1, Phase 2, CountAudit invariants
- [ ] Integration test: inspect endpoint returns consistent counts

### Sprint 2 (Weeks 3–4) — Core Pipeline (Phases 3–7)

**Goal**: ML microservice running, core extraction + normalization working.

- [ ] Python ML service scaffold: FastAPI, ONNX loader, `/ml/health`
- [ ] Deploy ML models: style detector, extractor, type classifier
- [ ] ML client in Node.js with circuit breaker
- [ ] Phase 3: Style Detection (ML + heuristic fallback)
- [ ] Phase 4: Field Extraction (structured ML contract + rollout + heuristic fallback)
- [ ] Phase 5: Author Disambiguation (AffilGood NER)
- [ ] Phase 6: Reference Type Classification
- [ ] Phase 6.5: LLM Fallback (GPT-5.4 nano) with overwrite guards
- [ ] Phase 7: Normalization
- [ ] Mandatory field schemas (all 54 combos)
- [ ] Unit tests: Phases 3–7, overwrite policy, mandatory field lookup
- [ ] Carrier.style immutability assertion

### Sprint 3 (Weeks 5–6) — Scoring, Enrichment, Rendering

**Goal**: End-to-end synchronous conversion working.

- [ ] Phase 8: Enrichment (CrossRef + OpenAlex, confidence-gated overwrite)
- [ ] Phase 10: Quality Scoring (ML regression + public status mapping)
- [ ] Phase 12: Rendering (citeproc-js for guaranteed styles)
- [ ] `/v1/convert` route — synchronous path (text/doi_list ≤ 25 refs)
- [ ] DOI fast-path (resolve → skip to Phase 9)
- [ ] Batch parallel processing (fan-out for Phases 3–6)
- [ ] TXT export (eager generation)
- [ ] Integration test: full-batch conversion end-to-end
- [ ] Integration test: inspect/convert count parity
- [ ] Integration test: enrichment overwrite guard
- [ ] Integration test: DOI fast-path

### Sprint 4 (Weeks 7–8) — Async, Files, Dedup, Authority

**Goal**: File uploads, large batches, and full pipeline with all phases.

- [ ] BullMQ async job wiring (pipeline queue)
- [ ] SSE progress stream (`/v1/jobs/:id/stream`)
- [ ] Job polling endpoint (`/v1/jobs/:id`)
- [ ] File upload: PDF/DOCX via Python ML service (`/v1/convert/upload`)
- [ ] Phase 9: Deduplication (MinHash + LSH)
- [ ] Phase 11: Authority Validation + Retraction Watch
- [ ] Lazy export generation (BibTeX, RIS, CSV, DOCX via export queue)
- [ ] `/v1/export/:jobId/:format` route
- [ ] Integration test: async jobs, file uploads, SSE stream
- [ ] Integration test: authority isolation (failure doesn't fail batch)
- [ ] Integration test: partial success envelope

### Sprint 5 (Weeks 9–10) — Feedback, Admin, Regression

**Goal**: Phase 13, admin dashboard, and regression infrastructure.

- [ ] Phase 13: Reports + Corrections + Active Learning queue
- [ ] `citation_versions` audit trail
- [ ] `/v1/reports` and `/v1/corrections` routes
- [ ] Admin routes (`/internal/admin/*`)
- [ ] Admin correction approval → `admin_confirmed` source
- [ ] Regression suite runner + fixture loader
- [ ] Populate initial regression suites (9 suites from §9.1)
- [ ] Run full regression corpus, publish to `docs/test-results/`
- [ ] Integration test: admin-confirmed protection
- [ ] API key management routes (`/v1/keys`)

### Sprint 6 (Weeks 11–12) — Hardening + v1 Gate

**Goal**: All 9 acceptance gates passing, production-ready.

- [ ] All 9 v1 acceptance gates passing (§9.3)
- [ ] Authority re-check background job (30-day rolling)
- [ ] Rate limiting hardening, quota enforcement
- [ ] Provider cache cleanup job (expire old entries)
- [ ] Load test: 3 concurrent async jobs, 200-ref batches, assert p95 < 5s
- [ ] Circuit breaker integration test (ML service failure → fallback works)
- [ ] Error response consistency audit
- [ ] Frontend contract documentation (inspect, convert, job, export shapes)
- [ ] `docs/engine.md` final update with actual performance numbers

### Deferred (Post-v1)

- Journal ranking / impact factor integration
- Frontend redesign to consume new API
- Large academic benchmark replication (GROBID-style test)
- Styles beyond the 4 guaranteed (IEEE, Harvard, AMA, ACS — render but not gated)
- Chrome extension integration
- B2B API tier with dedicated onboarding
- Fully automated active learning (maturity level 3)
- History sync / user project management

---

## 11. Deployment

### 11.1 Local Development

```bash
# Prerequisites: Node.js 20+, Python 3.11+, Postgres (Redis is OPTIONAL)

# Start Postgres (Redis only if you want Redis-backed cache/rate-limits)
docker compose up -d postgres

# Start Python ML service (dev port 8123; see ML_SERVICE_URL)
cd ml-service && pip install -r requirements.txt && uvicorn app.main:app --port 8123

# Start Node.js API
cd server && pnpm install && pnpm dev

# (Repo root) `npm run dev` launches the full stack — app at localhost:2397, server :4000, ml :8123.

# Run tests
pnpm test           # unit + integration
pnpm test:regression # full regression corpus
```

### 11.2 Production Architecture

> **⚠️ Corrected.** Production is **Render (backend) + Vercel (frontend)**, not Hetzner/Railway VPS-1/VPS-2.
> - **Backend**: Render Web Service (`render.yaml`: `runtime: node`, `rootDir: server`, `buildCommand: npm install && npm run build`, `startCommand: node dist/index.js`, `healthCheckPath: /health`). `SESSION_SECRET` is required in production (the dev placeholder is rejected at boot). Single Node process — **no separate BullMQ worker service**.
> - **Frontend**: Vercel static SPA (`frontend/vercel.json`: `outputDirectory: dist/public`, catch-all rewrite to `/index.html`).
> - **Postgres**: managed (system of record). **Redis**: optional (auth-revoke + provider cache; e.g. Upstash). **Cloudflare R2**: optional export offload.
> - **ML service**: separate process (`ML_SERVICE_URL`, default `http://localhost:8123` in dev).

| Service | Host | Notes |
|---------|------|-------|
| Node.js API (single process) | Render Web Service | in-process async; no BullMQ worker |
| Frontend SPA | Vercel | `dist/public`, SPA rewrites |
| Python ML Microservice | separate process / host | FastAPI + ONNX |
| PostgreSQL | Managed | system of record |
| Redis | Optional (Upstash, etc.) | auth-revoke + provider cache only |
| Cloudflare R2 | Cloudflare | optional export offload |

### 11.3 Environment Variables

> **⚠️ Corrected.** `REDIS_URL` is **optional** (the core runtime no longer requires Redis). Dev `ML_SERVICE_URL` defaults to `http://localhost:8123` (not `:8000`). `OPENAI_MODEL` defaults to `gpt-5.4-nano`. See `config.ts` / `.env.example` for the full, current schema (auth providers, feature flags, pipeline tuning, enrichment kill-switch, etc.).

```bash
# Node.js API (selected; see config.ts for the full set)
DATABASE_URL=postgresql://user:pass@host:5432/bulkreferences
# REDIS_URL is OPTIONAL — only needed for Redis-backed auth-revoke / provider cache / rate limits
REDIS_URL=                       # e.g. rediss://... (optional)
REDIS_USAGE_MODE=queue_first     # or 'balanced' to also enable Redis rate limits + provider cache
ML_SERVICE_URL=http://localhost:8123
OPENAI_API_KEY=sk-...            # optional; Phase 6.5 LLM repair
OPENAI_MODEL=gpt-5.4-nano
CROSSREF_EMAIL=contact@bulkreferences.com   # optional; improves Crossref rate limits
SESSION_SECRET=...               # REQUIRED in production
NODE_ENV=production

# Feature flags / gates
FEATURE_LIVE_ENRICH=false        # Phase 8 live-enrichment kill-switch (default OFF)
FEATURE_SCORED_DETECTOR=false
FEATURE_PDF_CLEANUP=true
ML_PHASE4_MODE=heuristic         # heuristic | shadow | primary (default heuristic)
PIPELINE_SYNC_THRESHOLD=500      # sync vs in-process-async cutoff

# Python ML Service
MODEL_DIR=/app/models
MAX_BATCH_SIZE=64
MAX_MEMORY_MB=3500
```

---

## 12. Gaps, Risks & Decisions Log

### 12.1 Resolved Contradictions

| Issue | Resolution |
|-------|-----------|
| Enrichment "additive-only" vs "overwrite if confident" | Confidence-gated: overwrite only when provider confidence ≥ 0.85 AND > existing. Never overwrites `admin_confirmed`. |
| LLM "only missing mandatory fields" vs "fill all fields" | LLM fills all fields when `referenceConfidence ≥ 0.85`. Otherwise, gaps only. Never overwrites `admin_confirmed`. |
| BullMQ vs pg-boss | **Superseded (2026-06):** neither shipped. The BullMQ layer was vestigial and removed; async is **in-process `queueMicrotask`** with Postgres as the durable store. Redis is **optional** (auth-revoke + provider cache), not required. |
| Inspect and convert different splitting paths | Both call identical Phase 1 + Phase 2 code. `CountAudit` emitted in both. |
| DOI fast-path skipping dedup | DOI-resolved refs skip Phases 2–8 but rejoin at Phase 9 (Dedup), not Phase 10. |
| Pending user corrections vs model | Pending corrections are suggestions — can be overwritten by stronger evidence. Only `admin_confirmed` is protected. |
| A/B/C/D buckets exposed to users | Internal only. Users see `ready`, `needs_review`, `needs_action`. |
| "500-char scan" confusion | Phase 1 scans first 500 chars for **input container format** (BibTeX? RIS? numbered list?). Phase 3 runs on **full text of each individual reference** for **citation style detection**. Two different things. |
| Per-type vs per-type×style mandatory fields | All 54 type×style combinations defined. Style affects which fields are mandatory (e.g., Vancouver doesn't require `issue` for journals). |
| GPT-4.1 nano vs GPT-5.4 nano | GPT-5.4 nano confirmed (released March 2026). |
| Eager vs lazy exports | TXT eager (generated at job completion). BibTeX/RIS/CSV/DOCX lazy (generated on first download). |
| File storage | Cloudflare R2 from day 1 (generous free tier, S3-compatible). |

### 12.2 Active Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| 128-token truncation loses data on long citations | High | Adaptive sliding window in Phase 4 (50% overlap). Hard truncation is forbidden. |
| 4 GB ML node runs out of memory | Medium | ONNX INT8, lazy loading, LRU eviction at 3.5 GB. Monitor via `/ml/health`. |
| Count audit delta > 5% on messy PDFs | Medium | Warning surfaced in job result. Regression suite tracks PDF artifact cases. Does not fail job. |
| CrossRef/OpenAlex rate limits | Medium | Per-provider concurrency cap (3). Cache in `provider_cache`. Exponential backoff. Skip enrichment gracefully. |
| Regression corpus grows too large | Low | Split: unit/integration (fast, per-commit) + full regression (nightly + triggered by tuning changes). |
| ~~citeproc-js bundle size (~2 MB)~~ | n/a | **Superseded:** rendering uses native renderers in `phase12Render.ts`, not citeproc-js. No CSL bundle is loaded. |
| ~~Redis single point of failure~~ | n/a | **Superseded:** Redis is optional (no queue dependency). Async runs in-process; Postgres is the system of record. A process restart re-schedules claimable async jobs via `resumeRuntimeJobs()`. |

### 12.3 Out of Scope for v1

- Journal ranking / impact factor integration
- Frontend redesign
- Large academic benchmark replication (GROBID-style)
- Non-guaranteed styles acceptance testing (IEEE, Harvard, AMA, ACS render but aren't gated)
- Chrome extension integration
- B2B dedicated API tier onboarding
- Fully automated active learning (maturity level 3)
- WebSocket support (SSE is sufficient for v1)
- Multi-language reference support (v1 is English-only with CJK author names)

### 12.4 Product Moats (How This Engine Is Different)

| Moat | Implementation |
|------|---------------|
| **1. Mixed-format batch input** | Phase 3 detects style per-reference independently. Output unified to one user-chosen style. No other tool does this at batch scale. |
| **2. Cleans unstructured input** | Phase 1 handles PDF copy-paste, messy references, drag-and-drop files. Phase 2 reconstructs multiline citations from PDF artifacts. |
| **3. Conversion, not generation** | Converts pre-existing citations to clean, standardized references. Not a citation generator — fills a gap no major tool addresses. |
| **4. Reference health transparency** | `ready / needs_review / needs_action` status per reference. User sees exactly which references need attention. Builds trust in the engine. |
| **5. Batch-scale duplicate detection** | Phase 9 clusters duplicates across the full reference list with dropdown UI. Only matters at bulk scale — exactly our niche. |
| **6. Sellable phase APIs** | Each phase is a standalone `PipelineStage` with clear input/output contracts. Can sell individual phases (ingestion, scoring, extraction) as separate B2B APIs. |

---

## File Structure

> **⚠️ Partially superseded.** This tree is the original layout. Key differences from the live repo:
> - The Python service is **`ml-service/`** (`app/main.py`), not `ai-services/`.
> - Engine code lives under **`server/src/engine/…`** (note `src/`); the orchestrator is `server/src/pipeline/orchestrator.ts` (+ `executionPolicy.ts`, `context.ts`, `coreBatch.ts`, `fastLane.ts`), not a single `engine/pipeline.ts`.
> - **`server/worker/` and `worker/queues.ts` do not exist** (BullMQ removed). Async lives in `server/src/jobs/runtime.ts`.
> - Phases include the added modules **`phase5_8StructuralFamilyRouter.ts`**, **`phase6_8SharedRepair.ts`**, and a split **`phase10Health.ts` + `phase10Score.ts`**; the feedback file is **`phase13FeedbackLoop.ts`** (not `phase13FeedbackRouter.ts`).
> - Routes are under `server/src/routes/` (e.g. `convert.ts`); deployment configs are `render.yaml` and `frontend/vercel.json`.

```
/   (historical layout — see corrections above)
├── ai-services/
│   ├── main.py
│   ├── config.py
│   ├── models/
│   │   ├── loader.py
│   │   ├── splitter.py
│   │   ├── style_detector.py
│   │   ├── extractor.py
│   │   ├── author_ner.py
│   │   ├── type_classifier.py
│   │   └── scorer.py
│   ├── parsers/
│   │   ├── pdf_parser.py
│   │   └── docx_parser.py
│   ├── schemas/
│   │   └── requests.py
│   ├── requirements.txt
│   └── Dockerfile
│
├── server/
│   ├── index.ts                    # Fastify entry point
│   ├── api/
│   │   ├── routes.ts               # Route registration
│   │   ├── middleware/
│   │   │   ├── auth.ts             # Dual auth (session + API key)
│   │   │   ├── rateLimit.ts        # Tier-based rate limiting
│   │   │   └── validation.ts       # Zod schema validation
│   │   └── handlers/
│   │       ├── inspect.ts
│   │       ├── convert.ts
│   │       ├── upload.ts
│   │       ├── jobs.ts
│   │       ├── export.ts
│   │       ├── reports.ts
│   │       ├── corrections.ts
│   │       ├── auth.ts
│   │       ├── keys.ts
│   │       ├── health.ts
│   │       └── admin.ts
│   ├── db/
│   │   ├── schema.ts               # Drizzle table definitions
│   │   ├── migrations/             # Drizzle migrations
│   │   └── client.ts               # Drizzle client + pool
│   ├── engine/
│   │   ├── pipeline.ts             # Pipeline orchestrator
│   │   ├── types/
│   │   │   ├── index.ts            # Barrel export
│   │   │   ├── field.ts
│   │   │   ├── citation.ts
│   │   │   ├── pipeline.ts
│   │   │   ├── ingestion.ts
│   │   │   ├── phase-results.ts
│   │   │   ├── carrier.ts
│   │   │   ├── api.ts
│   │   │   └── overwrite-policy.ts
│   │   ├── phases/
│   │   │   ├── phase1Ingest.ts
│   │   │   ├── phase2Split.ts
│   │   │   ├── phase3StyleDetect.ts
│   │   │   ├── phase4Extract.ts
│   │   │   ├── phase5AuthorDisambig.ts
│   │   │   ├── phase6TypeClassify.ts
│   │   │   ├── phase6_5LLMFallback.ts
│   │   │   ├── phase7Normalize.ts
│   │   │   ├── phase8Enrich.ts
│   │   │   ├── phase9Dedup.ts
│   │   │   ├── phase10Score.ts
│   │   │   ├── phase11Authority.ts
│   │   │   ├── phase12Render.ts
│   │   │   └── phase13FeedbackRouter.ts
│   │   ├── mandatory-fields.ts
│   │   └── ml-client.ts            # HTTP client + circuit breaker
│   ├── worker/
│   │   ├── queues.ts               # BullMQ queue definitions
│   │   ├── pipeline-worker.ts      # Main conversion worker
│   │   ├── export-worker.ts        # Lazy export generation
│   │   ├── authority-worker.ts     # 30-day re-check worker
│   │   └── regression-worker.ts    # Regression suite runner
│   ├── services/
│   │   ├── crossref.ts
│   │   ├── openalex.ts
│   │   ├── retractionWatch.ts
│   │   ├── openai.ts               # GPT-5.4 nano client
│   │   ├── storage.ts              # R2 client abstraction
│   │   └── cache.ts                # Redis cache helpers
│   └── package.json
│
├── tests/
│   ├── unit/
│   ├── integration/
│   ├── regression/
│   ├── fixtures/
│   └── output/
│
├── docs/
│   ├── engine.md                   # This file
│   ├── tech.md                     # ML models, FastAPI, external APIs
│   ├── product.md                  # B2C and B2B product description
│   ├── academic-benchmark.md       # Academic benchmark plan (post-v1)
│   ├── extension.md                # Chrome extension docs
│   └── test-results/               # Regression run outputs
│
├── frontend/                       # Existing React frontend (unchanged for now)
│
├── docker-compose.yml              # Postgres + Redis for local dev
├── package.json                    # Root monorepo config
└── pnpm-workspace.yaml
```

---

## 13. Gap Resolutions (Post-Audit Addendum)

These items were identified as missing or underspecified during the plan audit and resolved.

### 13.1 Pipeline Orchestrator — State Machine

File (actual): `server/src/pipeline/orchestrator.ts` (`runConvertPipeline`) + `executionPolicy.ts`, `context.ts`, `coreBatch.ts`, `fastLane.ts`, `blockBatching.ts`.

> **⚠️ Illustrative, partly superseded.** The real orchestrator (`runConvertPipeline`) keeps the spirit below — per-stage records, abort propagation, fan-out over batches — but differs in specifics: it is not a single `server/engine/pipeline.ts`; optional stages (LLM, enrichment, authority, feedback) are gated by `ctx.options`/the resolved `parseProfile`; the core batch runs P4/P5/P5.8/P6 (then P6.8/P7/P8 in the tail), optionally across `worker_threads`; Phase 10 is `phase10Health` (the `phase10Score` reference below is an alias); and rendering is native, not citeproc-js. Read the snippet as pseudocode for the control flow, not the literal call sequence.

The orchestrator transitions each `ReferenceCarrier` (or the batch) through phases with per-stage diagnostics, abort propagation, and explicit error classification.

```typescript
// server/engine/pipeline.ts

import { AbortController } from 'node:abort-controller';
import pMap from 'p-map';

// Per-phase timeout configuration (ms)
const PHASE_TIMEOUTS: Record<PhaseId, number> = {
  ingestion:              15_000,  // PDF extraction can be slow
  block_aggregation:       5_000,
  splitting:               5_000,
  style_detection:        10_000,  // ML batch call
  extraction:             10_000,  // ML batch call (largest model)
  author_disambiguation:  10_000,  // ML batch call (lazy-loaded model)
  type_classification:    10_000,  // ML batch call
  llm_fallback:           15_000,  // OpenAI API call
  normalization:           3_000,  // CPU-only, fast
  enrichment:              8_000,  // CrossRef + OpenAlex parallel
  deduplication:           5_000,  // CPU-only, MinHash
  quality_scoring:        10_000,  // ML call or rules fallback
  authority_validation:    5_000,  // Retraction Watch
  rendering:               5_000,  // citeproc-js
  feedback:                3_000,  // DB writes only
};

// Error classification: which errors halt the pipeline vs continue
type ErrorSeverity = 'fatal' | 'degraded' | 'skip';

function classifyPhaseError(phaseId: PhaseId, error: Error): ErrorSeverity {
  // Phase 1 failure = nothing to process → fatal
  if (phaseId === 'ingestion') return 'fatal';
  // Phase 2 failure = can't split → fatal
  if (phaseId === 'block_aggregation' || phaseId === 'splitting') return 'fatal';
  // All other phases: degrade but continue
  return 'degraded';
}

export async function runPipeline(
  request: EngineJobRequest,
  ctx: PipelineContext
): Promise<EngineJobResult> {
  const { abortSignal } = ctx;

  // ═══ Phase 1: Ingest ═══
  const envelope = await runPhaseWithTimeout(
    phase1Ingest, request, ctx, PHASE_TIMEOUTS.ingestion
  );
  if (!envelope) return fatalResult(ctx, 'ingestion');

  // Separate DOI fast-path refs from normal refs
  const { doiResolvedBlocks, normalBlocks } = separateDoiResolved(envelope);

  // ═══ Phase 2: Split ═══
  const { blocks, countAudit } = await runPhaseWithTimeout(
    phase2Split, { envelope, normalBlocks }, ctx, PHASE_TIMEOUTS.splitting
  );
  if (!blocks) return fatalResult(ctx, 'splitting');

  // Build initial carriers from split blocks
  let carriers = blocks.map(toInitialCarrier);

  // ═══ Phase 3: Style Detection (batched) ═══
  carriers = await runPhaseWithTimeout(
    phase3StyleDetect, carriers, ctx, PHASE_TIMEOUTS.style_detection
  ) ?? carriers; // on failure: carriers continue with style.isUnknown = true

  // ═══ Phases 4–6: Parallel Fan-Out ═══
  // Chunk into batches of 32, run 4 concurrently
  const chunks = chunkArray(carriers, 32);
  const parallelResults = await pMap(chunks, async (chunk) => {
    if (abortSignal?.aborted) return chunk;

    // Phase 4: Extract → Phase 5: Authors → Phase 6: Type (sequential per chunk)
    let processed = await runPhaseWithTimeout(
      phase4Extract, chunk, ctx, PHASE_TIMEOUTS.extraction
    ) ?? chunk;
    processed = await runPhaseWithTimeout(
      phase5AuthorDisambig, processed, ctx, PHASE_TIMEOUTS.author_disambiguation
    ) ?? processed;
    processed = await runPhaseWithTimeout(
      phase6TypeClassify, processed, ctx, PHASE_TIMEOUTS.type_classification
    ) ?? processed;
    return processed;
  }, { concurrency: 4 });
  carriers = parallelResults.flat();

  // ═══ Phase 6.5: LLM Fallback (only flagged refs) ═══
  const flagged = carriers.filter(needsLLMFallback);
  if (flagged.length > 0) {
    const filled = await runPhaseWithTimeout(
      phase6_5LLMFallback, flagged, ctx, PHASE_TIMEOUTS.llm_fallback
    );
    if (filled) mergeBack(carriers, filled);
  }

  // ═══ Phase 7–13: Sequential ═══
  carriers = await runPhaseWithTimeout(phase7Normalize, carriers, ctx, PHASE_TIMEOUTS.normalization) ?? carriers;
  carriers = await runPhaseWithTimeout(phase8Enrich, carriers, ctx, PHASE_TIMEOUTS.enrichment) ?? carriers;

  // DOI fast-path refs rejoin here at Phase 9
  const doiCarriers = doiResolvedBlocks.map(toDoiFastPathCarrier);
  carriers = [...carriers, ...doiCarriers];
  // Re-sort by original index
  carriers.sort((a, b) => a.index - b.index);

  carriers = await runPhaseWithTimeout(phase9Dedup, carriers, ctx, PHASE_TIMEOUTS.deduplication) ?? carriers;
  carriers = await runPhaseWithTimeout(phase10Score, carriers, ctx, PHASE_TIMEOUTS.quality_scoring) ?? carriers;
  carriers = await runPhaseWithTimeout(phase11Authority, carriers, ctx, PHASE_TIMEOUTS.authority_validation) ?? carriers;
  carriers = await runPhaseWithTimeout(phase12Render, carriers, ctx, PHASE_TIMEOUTS.rendering) ?? carriers;
  await runPhaseWithTimeout(phase13Feedback, carriers, ctx, PHASE_TIMEOUTS.feedback);

  return buildResult(carriers, countAudit, ctx);
}

/** Wraps a phase call with timeout + error handling + stageLog recording */
async function runPhaseWithTimeout<TIn, TOut>(
  phase: PipelineStage<TIn, TOut>,
  input: TIn,
  ctx: PipelineContext,
  timeoutMs: number
): Promise<TOut | null> {
  const start = Date.now();
  const phaseAbort = new AbortController();

  // Propagate parent abort
  ctx.abortSignal?.addEventListener('abort', () => phaseAbort.abort());

  const timer = setTimeout(() => phaseAbort.abort(), timeoutMs);

  try {
    const result = await phase.run(input, { ...ctx, abortSignal: phaseAbort.signal });
    ctx.stageLog.push({
      stageId: phase.phaseId,
      contractVersion: phase.contractVersion,
      phaseId: phase.phaseId,
      status: 'success',
      durationMs: Date.now() - start,
    });
    return result;
  } catch (error) {
    const severity = classifyPhaseError(phase.phaseId, error as Error);
    ctx.stageLog.push({
      stageId: phase.phaseId,
      contractVersion: phase.contractVersion,
      phaseId: phase.phaseId,
      status: 'error',
      durationMs: Date.now() - start,
      message: (error as Error).message,
      code: phaseAbort.signal.aborted ? 'PHASE_TIMEOUT' : 'PHASE_ERROR',
    });

    if (severity === 'fatal') return null;  // caller checks null → abort pipeline
    return null;  // degraded: caller uses fallback (input passthrough)
  } finally {
    clearTimeout(timer);
  }
}
```

### 13.2 Reformat Endpoint

```
POST /v1/reformat
  Auth:     session | api_key
  Purpose:  Re-render existing job results in a different output style.
            Re-runs Phase 7 (normalization) + Phase 12 (rendering) only.
            Does NOT re-run extraction, enrichment, scoring, or authority.
```

```typescript
// Request
interface ReformatRequest {
  jobId: string;
  newStyle: CitationStyle;  // e.g. 'mla9'
}

// Response: same shape as ConvertResponse but with new renderedText + exports
interface ReformatResponse {
  jobId: string;
  outputStyle: CitationStyle;
  references: ProcessedCitation[];  // same fields, new renderedText
  exports: Array<{ format: string; available: boolean }>;
}

// Implementation:
// 1. Load all citations for jobId from DB (fields JSONB column)
// 2. Re-run Phase 7 normalization with newStyle rules
// 3. Re-run Phase 12 rendering with citeproc-js in newStyle
// 4. Generate new TXT export (eager), invalidate old lazy exports
// 5. Update citations.output_style and citations.rendered_text in DB
// 6. Return updated results
//
// Estimated latency: ~50-200ms for 50 refs (normalization + citeproc-js)
// No ML service calls, no external API calls.
```

Add to route table:
```
POST    /v1/reformat                    session|key   Re-render job in new style (Phase 7+12).
```

### 13.3 Recheck Endpoint

```
POST /v1/recheck
  Auth:     session | api_key
  Purpose:  Re-verify enrichment + authority for a single citation.
            Re-runs Phase 8 (enrichment) + Phase 11 (authority).
            Force-bypasses cache. Respects overwrite policy.
```

```typescript
// Request
interface RecheckRequest {
  citationId: string;
  force: boolean;  // bypass provider cache
}

// Response
interface RecheckResponse {
  citationId: string;
  enrichmentResult: EnrichmentResult;
  authorityResult: AuthorityResult;
  fieldsUpdated: string[];           // which fields changed
  previousScore: number;
  newScore: number;
}

// Implementation:
// 1. Load citation from DB
// 2. Re-run Phase 8 enrichment (CrossRef + OpenAlex, force-bypass cache if force=true)
// 3. Re-run Phase 11 authority (Retraction Watch + author conflict check)
// 4. Re-run Phase 10 scoring (recalculate rawScore with new enrichment data)
// 5. Apply authority adjustments to get new displayScore
// 6. Respects overwrite policy: admin_confirmed fields are NEVER touched
// 7. Update citation in DB, create citation_version entry
// 8. Return diff
//
// Synchronous, ~3-6s (external API calls)
```

Add to route table:
```
POST    /v1/recheck                     session|key   Re-verify enrichment + authority (Phase 8+10+11).
```

### 13.4 Input Sanitization

**Strategy**: Output encoding only. Store raw text as-is. Sanitize at the rendering boundary.

```typescript
// Phase 12 rendering: HTML-encode all rendered output
function sanitizeRenderedText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

// Applied to ALL renderedText before storage:
citation.rendered_text = sanitizeRenderedText(citeproc.render(cslJson));

// Frontend rules:
// - ALWAYS use textContent or React's default JSX escaping
// - NEVER use dangerouslySetInnerHTML on any engine output
// - If HTML rendering is ever needed (e.g., italics in titles),
//   use DOMPurify at the frontend layer with a strict allowlist:
//   DOMPurify.sanitize(text, { ALLOWED_TAGS: ['i', 'em', 'sub', 'sup'] })
```

### 13.5 Graceful Shutdown

> **⚠️ Superseded.** There are no BullMQ workers to `close()` — the snippet below describes the removed queue design. In reality shutdown stops accepting HTTP requests and closes DB connections; in-flight in-process jobs either finish or are re-claimed on next startup via `resumeRuntimeJobs()` (DB-backed claim with `ASYNC_JOB_STALE_MS`).

```typescript
// HISTORICAL — pipelineWorker/exportWorker/authorityWorker do not exist.
// server/index.ts — shutdown handler

import { pipelineWorker, exportWorker, authorityWorker } from './worker';

const GRACE_PERIOD_MS = 30_000;  // 30 seconds

async function gracefulShutdown(signal: string) {
  logger.info({ signal }, 'Shutdown signal received, draining workers...');

  // Stop accepting new HTTP requests
  await fastify.close();

  // Tell BullMQ workers to stop taking new jobs and finish in-progress ones
  await Promise.all([
    pipelineWorker.close(),
    exportWorker.close(),
    authorityWorker.close(),
  ]);

  // Close DB connections
  await db.end();

  logger.info('Graceful shutdown complete');
  process.exit(0);
}

// BullMQ's built-in behavior on worker.close():
// 1. Stops polling for new jobs
// 2. Waits for in-progress jobs to finish (up to lockDuration, default 30s)
// 3. If job doesn't finish in time, it returns to the queue automatically
//    and will be retried by another worker (or on next startup)

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
```

### 13.6 Pagination on Job Results

```
GET /v1/jobs/:id/references?cursor=X&limit=50
```

```typescript
// Job metadata endpoint (always returns full summary, no refs)
// GET /v1/jobs/:id → JobStatusResponse (summary, countAudit, stats, progress — NO references array)

// Paginated references endpoint (separate)
// GET /v1/jobs/:id/references?cursor=<lastCitationId>&limit=50

interface PaginatedReferencesResponse {
  references: ProcessedCitation[];
  pagination: {
    total: number;
    limit: number;
    hasMore: boolean;
    nextCursor: string | null;    // citation.id of last item
  };
}

// Default limit: 50, max: 200
// Cursor: citation.id (UUID), ordered by reference_index ASC
// First page: omit cursor parameter
// Next page: cursor = last citation.id from previous response

// GET /v1/jobs/:id still returns full ConvertResponse for sync jobs (≤25 refs)
// For async jobs, GET /v1/jobs/:id returns JobStatusResponse with summary only
// Client fetches references via paginated endpoint
```

Add to route table:
```
GET     /v1/jobs/:id/references         session|key   Paginated citation results (cursor, limit).
```

### 13.7 CSL-JSON Field Mapping (Per-Type)

```typescript
// server/engine/phases/csl-mapping.ts

import type { ExtractedFields, ReferenceType, CanonicalAuthor } from '../types';

interface CSLItem {
  type: string;
  [key: string]: unknown;
}

// CSL type mapping
const CSL_TYPE_MAP: Record<ReferenceType, string> = {
  'article-journal':  'article-journal',
  'book':             'book',
  'book-chapter':     'chapter',
  'thesis':           'thesis',
  'conference-paper': 'paper-conference',
  'webpage':          'webpage',
  'report':           'report',
  'dataset':          'dataset',
  'preprint':         'article',  // CSL has no 'preprint' type
  'unknown':          'article',
};

// Per-type field mapping
const FIELD_MAPPINGS: Record<ReferenceType, Record<string, string>> = {
  'article-journal': {
    title:    'title',
    journal:  'container-title',
    volume:   'volume',
    issue:    'issue',
    pages:    'page',
    doi:      'DOI',
    url:      'URL',
    publisher: 'publisher',
    articleNumber: 'number',
  },
  'book': {
    title:              'title',
    publisher:          'publisher',
    placeOfPublication: 'publisher-place',
    edition:            'edition',
    doi:                'DOI',
    url:                'URL',
  },
  'book-chapter': {
    title:              'title',
    bookTitle:          'container-title',
    publisher:          'publisher',
    placeOfPublication: 'publisher-place',
    pages:              'page',
    edition:            'edition',
    doi:                'DOI',
    url:                'URL',
  },
  'conference-paper': {
    title:              'title',
    conferenceTitle:    'event-title',     // NOT container-title
    publisher:          'publisher',
    placeOfPublication: 'event-place',     // NOT publisher-place
    pages:              'page',
    doi:                'DOI',
    url:                'URL',
  },
  'thesis': {
    title:       'title',
    institution: 'publisher',             // CSL uses publisher for institution
    thesisType:  'genre',                 // "Doctoral dissertation" → genre
    doi:         'DOI',
    url:         'URL',
  },
  'webpage': {
    title:        'title',
    siteName:     'container-title',
    url:          'URL',
    accessedDate: 'accessed',             // requires date-parts format
  },
  'report': {
    title:        'title',
    institution:  'publisher',
    reportNumber: 'number',
    doi:          'DOI',
    url:          'URL',
  },
  'dataset': {
    title:      'title',
    repository: 'publisher',              // or 'archive'
    doi:        'DOI',
    url:        'URL',
    edition:    'version',
  },
  'preprint': {
    title:      'title',
    repository: 'publisher',
    doi:        'DOI',
    url:        'URL',
  },
  'unknown': {
    title:     'title',
    journal:   'container-title',
    volume:    'volume',
    issue:     'issue',
    pages:     'page',
    doi:       'DOI',
    url:       'URL',
    publisher: 'publisher',
  },
};

function authorToCSL(author: CanonicalAuthor): { family?: string; given?: string; literal?: string } {
  if (author.isCorporate && author.literal) {
    return { literal: author.literal };
  }
  return {
    family: author.family,
    given: author.given ?? author.initials ?? undefined,
  };
}

export function toCSLJSON(fields: ExtractedFields, type: ReferenceType): CSLItem {
  const mapping = FIELD_MAPPINGS[type] ?? FIELD_MAPPINGS['unknown'];
  const item: CSLItem = {
    type: CSL_TYPE_MAP[type] ?? 'article',
  };

  // Map authors
  if (fields.authors?.value?.length) {
    item.author = fields.authors.value.map(authorToCSL);
  }

  // Map editors
  if (fields.editors?.value?.length) {
    item.editor = fields.editors.value.map(authorToCSL);
  }

  // Map year → issued date-parts
  if (fields.year?.value) {
    item.issued = { 'date-parts': [[fields.year.value]] };
  }

  // Map accessed date → accessed date-parts
  if (fields.accessedDate?.value) {
    const parsed = parseAccessedDate(fields.accessedDate.value);
    if (parsed) item.accessed = { 'date-parts': [parsed] };
  }

  // Map all other fields via the per-type mapping
  for (const [fieldName, cslProp] of Object.entries(mapping)) {
    if (fieldName === 'accessedDate') continue;  // handled above
    const fieldValue = (fields as any)[fieldName];
    if (fieldValue?.value != null) {
      item[cslProp] = fieldValue.value;
    }
  }

  return item;
}
```

### 13.8 DOI Fast-Path Conflict Handling

When a DOI resolves via CrossRef but the user's raw text contains different metadata:

```typescript
// In Phase 1, after DOI resolution succeeds:

function buildDoiResolvedBlock(
  rawText: string,
  doi: string,
  providerFields: ExtractedFields
): RawBlock {
  // Lightweight regex extraction from raw text (NOT full ML extraction)
  const rawTitle = extractTitleRegex(rawText);
  const rawAuthors = extractAuthorsRegex(rawText);
  const rawYear = extractYearRegex(rawText);

  // Compare raw text fields vs provider fields
  const conflicts: string[] = [];

  if (rawTitle && providerFields.title?.value) {
    const similarity = jaroWinkler(normalize(rawTitle), normalize(providerFields.title.value));
    if (similarity < 0.85) {
      conflicts.push('title');
    }
  }
  if (rawYear && providerFields.year?.value && rawYear !== String(providerFields.year.value)) {
    conflicts.push('year');
  }

  return {
    index: -1,  // assigned later
    text: rawText,
    splitMethod: 'doi_resolved',
    splitConfidence: 1.0,
    isDoiResolved: true,
    resolvedFields: providerFields,
    // If conflicts exist, flag for review
    flags: conflicts.length > 0
      ? [`metadata_mismatch:${conflicts.join(',')}`]
      : [],
  };
}

// At Phase 10 scoring, metadata_mismatch flag → publicStatus = 'needs_review'
// UI shows: "DOI resolved but raw text differs from provider data for: title, year"
// User can see both the provider version and their raw text
```

### 13.9 Logging & Observability

**Strategy**: Pino structured logging (Fastify's built-in logger) with correlation IDs.

```typescript
// server/index.ts
const fastify = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? 'info',
    transport: process.env.NODE_ENV === 'development'
      ? { target: 'pino-pretty', options: { colorize: true } }
      : undefined,  // production: raw JSON to stdout
  },
});

// Every request gets a correlationId
fastify.addHook('onRequest', (request, reply, done) => {
  request.correlationId = request.headers['x-correlation-id'] ?? randomUUID();
  done();
});

// Pipeline phases use a child logger scoped to jobId + phaseId
function phaseLogger(ctx: PipelineContext, phaseId: PhaseId) {
  return ctx.logger.child({
    jobId: ctx.jobId,
    phaseId,
    pipelineMajor: ctx.pipelineMajor,
  });
}

// Usage in any phase:
const log = phaseLogger(ctx, 'extraction');
log.info({ refCount: carriers.length }, 'Starting field extraction');
log.warn({ refIndex: 3, code: 'ML_TIMEOUT' }, 'ML service timed out, using regex fallback');
log.error({ error: err.message, stack: err.stack }, 'Phase failed');

// Log levels:
//   error  — phase failures, external API errors, data integrity issues
//   warn   — fallbacks triggered, count audit drift, timeout recoveries
//   info   — phase start/complete, job lifecycle, auth events
//   debug  — per-reference processing details, cache hits, field-level decisions
//
// Production: info level. Debug enabled per-request via ?debug=true query param.

// Structured fields on every log line:
//   jobId, phaseId, correlationId, userId, tier, timestamp
//   → enables: "show me all logs for job X" or "all Phase 4 errors today"
```

### 13.10 Error Code Catalog

```typescript
// server/engine/types/error-codes.ts

export const ErrorCodes = {
  // ── Phase 1: Ingestion ──
  INGEST_PDF_EXTRACTION_FAILED:    'INGEST_PDF_EXTRACTION_FAILED',
  INGEST_DOCX_EXTRACTION_FAILED:   'INGEST_DOCX_EXTRACTION_FAILED',
  INGEST_UNSUPPORTED_FORMAT:       'INGEST_UNSUPPORTED_FORMAT',
  INGEST_FILE_TOO_LARGE:           'INGEST_FILE_TOO_LARGE',
  INGEST_EMPTY_INPUT:              'INGEST_EMPTY_INPUT',
  INGEST_DOI_RESOLUTION_FAILED:    'INGEST_DOI_RESOLUTION_FAILED',
  INGEST_DOI_INCOMPLETE_METADATA:  'INGEST_DOI_INCOMPLETE_METADATA',

  // ── Phase 2: Splitting ──
  SPLIT_COUNT_AUDIT_DRIFT:         'SPLIT_COUNT_AUDIT_DRIFT',
  SPLIT_BLOCK_TOO_SHORT:           'SPLIT_BLOCK_TOO_SHORT',
  SPLIT_BLOCK_TOO_LONG:            'SPLIT_BLOCK_TOO_LONG',
  SPLIT_ML_CLASSIFIER_FAILED:      'SPLIT_ML_CLASSIFIER_FAILED',
  SPLIT_UNCERTAIN_BOUNDARY:        'SPLIT_UNCERTAIN_BOUNDARY',

  // ── Phase 3: Style Detection ──
  STYLE_ML_TIMEOUT:                'STYLE_ML_TIMEOUT',
  STYLE_LOW_CONFIDENCE:            'STYLE_LOW_CONFIDENCE',
  STYLE_UNKNOWN:                   'STYLE_UNKNOWN',

  // ── Phase 4: Extraction ──
  EXTRACT_ML_UNAVAILABLE:          'EXTRACT_ML_UNAVAILABLE',
  EXTRACT_TIMEOUT:                 'EXTRACT_TIMEOUT',
  EXTRACT_MANDATORY_MISSING:       'EXTRACT_MANDATORY_MISSING',
  EXTRACT_LOW_CONFIDENCE:          'EXTRACT_LOW_CONFIDENCE',
  EXTRACT_PARSE_FAILED:            'EXTRACT_PARSE_FAILED',

  // ── Phase 5: Author Disambiguation ──
  AUTHOR_ML_TIMEOUT:               'AUTHOR_ML_TIMEOUT',
  AUTHOR_CORPORATE_DETECTED:       'AUTHOR_CORPORATE_DETECTED',
  AUTHOR_CJK_FALLBACK:            'AUTHOR_CJK_FALLBACK',

  // ── Phase 6: Type Classification ──
  TYPE_ML_TIMEOUT:                 'TYPE_ML_TIMEOUT',
  TYPE_LOW_CONFIDENCE:             'TYPE_LOW_CONFIDENCE',
  TYPE_UNKNOWN:                    'TYPE_UNKNOWN',

  // ── Phase 6.5: LLM Fallback ──
  LLM_API_TIMEOUT:                 'LLM_API_TIMEOUT',
  LLM_API_RATE_LIMITED:            'LLM_API_RATE_LIMITED',
  LLM_INVALID_JSON_RESPONSE:       'LLM_INVALID_JSON_RESPONSE',
  LLM_EMPTY_RESPONSE:              'LLM_EMPTY_RESPONSE',
  LLM_LOW_REFERENCE_CONFIDENCE:    'LLM_LOW_REFERENCE_CONFIDENCE',
  LLM_OVERWRITE_BLOCKED:           'LLM_OVERWRITE_BLOCKED',

  // ── Phase 7: Normalization ──
  NORM_INVALID_YEAR:               'NORM_INVALID_YEAR',
  NORM_DOI_MALFORMED:              'NORM_DOI_MALFORMED',

  // ── Phase 8: Enrichment ──
  ENRICH_CROSSREF_TIMEOUT:         'ENRICH_CROSSREF_TIMEOUT',
  ENRICH_CROSSREF_RATE_LIMITED:    'ENRICH_CROSSREF_RATE_LIMITED',
  ENRICH_OPENALEX_TIMEOUT:         'ENRICH_OPENALEX_TIMEOUT',
  ENRICH_OPENALEX_RATE_LIMITED:    'ENRICH_OPENALEX_RATE_LIMITED',
  ENRICH_NO_MATCH:                 'ENRICH_NO_MATCH',
  ENRICH_OVERWRITE_APPLIED:        'ENRICH_OVERWRITE_APPLIED',
  ENRICH_OVERWRITE_BLOCKED_ADMIN:  'ENRICH_OVERWRITE_BLOCKED_ADMIN',
  ENRICH_SKIPPED:                  'ENRICH_SKIPPED',

  // ── Phase 9: Deduplication ──
  DEDUP_CANDIDATE_FOUND:           'DEDUP_CANDIDATE_FOUND',
  DEDUP_DOI_EXACT_MATCH:           'DEDUP_DOI_EXACT_MATCH',

  // ── Phase 10: Scoring ──
  SCORE_ML_TIMEOUT:                'SCORE_ML_TIMEOUT',
  SCORE_MANDATORY_FIELDS_MISSING:  'SCORE_MANDATORY_FIELDS_MISSING',

  // ── Phase 11: Authority ──
  AUTH_RETRACTION_FOUND:           'AUTH_RETRACTION_FOUND',
  AUTH_EXPRESSION_OF_CONCERN:      'AUTH_EXPRESSION_OF_CONCERN',
  AUTH_AUTHOR_CONFLICT:            'AUTH_AUTHOR_CONFLICT',
  AUTH_CHECK_TIMEOUT:              'AUTH_CHECK_TIMEOUT',
  AUTH_CHECK_SKIPPED:              'AUTH_CHECK_SKIPPED',

  // ── Phase 12: Rendering ──
  RENDER_CSL_ERROR:                'RENDER_CSL_ERROR',
  RENDER_MISSING_MANDATORY_FIELDS: 'RENDER_MISSING_MANDATORY_FIELDS',

  // ── Phase 13: Corrections ──
  CORRECTION_DUPLICATE_REPORT:     'CORRECTION_DUPLICATE_REPORT',

  // ── Infrastructure ──
  PHASE_TIMEOUT:                   'PHASE_TIMEOUT',
  PHASE_ERROR:                     'PHASE_ERROR',
  CIRCUIT_BREAKER_OPEN:            'CIRCUIT_BREAKER_OPEN',
  RATE_LIMIT_EXCEEDED:             'RATE_LIMIT_EXCEEDED',
  CONCURRENT_JOB_LIMIT:            'CONCURRENT_JOB_LIMIT',
  IDEMPOTENCY_CONFLICT:            'IDEMPOTENCY_CONFLICT',
  INPUT_VALIDATION_FAILED:         'INPUT_VALIDATION_FAILED',
  UNAUTHORIZED:                    'UNAUTHORIZED',
  FORBIDDEN:                       'FORBIDDEN',
  JOB_NOT_FOUND:                   'JOB_NOT_FOUND',
  JOB_EXPIRED:                     'JOB_EXPIRED',
} as const;

export type ErrorCode = typeof ErrorCodes[keyof typeof ErrorCodes];
```

### 13.11 Concurrent Job Limits

```typescript
// Per-tier concurrent job caps
const CONCURRENT_JOB_LIMITS = {
  anonymous: 1,
  free:      2,
  pro:       10,
  b2b:       50,  // or custom per api_key.rate_limit
} as const;

// Checked before queuing any async job:
async function checkConcurrentJobLimit(userId: string | null, tier: string): Promise<void> {
  const limit = CONCURRENT_JOB_LIMITS[tier] ?? CONCURRENT_JOB_LIMITS.free;

  const activeCount = await db
    .select({ count: sql`count(*)` })
    .from(jobs)
    .where(and(
      userId ? eq(jobs.userId, userId) : sql`user_id IS NULL`,
      inArray(jobs.status, ['pending', 'processing']),
    ));

  if (activeCount[0].count >= limit) {
    throw new AppError(429, ErrorCodes.CONCURRENT_JOB_LIMIT,
      `Maximum ${limit} concurrent jobs for ${tier} tier. Wait for existing jobs to complete.`
    );
  }
}
```

### 13.12 Underspecified Items — Quick Resolutions

**Idempotency logic**: When `idempotencyKey` is provided:
- Hash the key. Check `jobs.idempotency_key`.
- Same key + same `input_hash` → return existing job (cached result or job ID for polling).
- Same key + different `input_hash` → HTTP 409 `IDEMPOTENCY_CONFLICT`.
- Keys expire when the job is cleaned up (24h for completed, 7d for failed).

**BibTeX/RIS parsing**: Use `@retorquere/bibtex-parser` for BibTeX and a lightweight custom RIS parser (RIS format is trivial: tag-value pairs separated by `ER  -`). Both run in Node.js (Phase 1), no Python call needed.

**Reprocessing flow** (`POST /internal/admin/reprocess/:id`):
- Re-runs the full pipeline on the citation's `raw_text` with current pipeline version.
- Creates a new `job_attempt` record linked to the original job.
- `admin_confirmed` fields are preserved via the overwrite policy (all phases check `isAdminProtected()`).
- Creates a `citation_versions` entry before and after.
- Updates the citation in-place (same `citation.id`), does NOT create a new citation row.

**Admin stats response** (`GET /internal/admin/stats`):
```typescript
interface AdminStats {
  jobs: { total: number; completed: number; failed: number; partial: number; pending: number };
  citations: { total: number; ready: number; needsReview: number; needsAction: number };
  quality: { avgRawScore: number; avgDisplayScore: number; bucketDistribution: Record<string, number> };
  pipeline: { avgDurationMs: number; p95DurationMs: number; phaseTimings: Record<PhaseId, number> };
  fallbacks: { llmFallbackRate: number; circuitBreakerTrips: number; regexFallbackRate: number };
  providers: { crossrefCalls: number; openalexCalls: number; cacheHitRate: number; llmTokensUsed: number };
  corrections: { pending: number; approved: number; rejected: number; consensusCandidates: number };
  queue: { depth: number; activeWorkers: number; completedToday: number; failedToday: number };
  period: 'last_24h' | 'last_7d' | 'last_30d';  // filterable
}
```

**Regression fixture seeding**: Initial fixtures are manually authored from 3 sources:
1. Real references collected from academic papers (10–20 per style, manually verified).
2. Known failure cases from the existing frontend's report queue (if any exist).
3. Synthetic edge cases: corporate authors, CJK names, very long references, DOI-only inputs, mixed-style batches, PDF-artifact-contaminated text.
Provenance field tracks origin: `'manual'`, `'existing_report'`, `'synthetic'`.

**Job/cache cleanup cron**: *(Superseded — no BullMQ `cleanupQueue`/repeatable job.)* The intended cleanup work (expire `provider_cache`, `sessions`, `export_artifacts`, R2 objects past their retention TTL) would run as an in-process interval or an external scheduled task. The cleanup *queries* described below remain accurate as the work to perform:
```text
1. DELETE FROM provider_cache    WHERE expires_at < now()
2. DELETE FROM sessions          WHERE expires_at < now()
3. List R2 objects older than retention TTL → delete
4. DELETE FROM export_artifacts  WHERE retained_until < now()
5. Log counts for observability
```

**SSE reconnection protocol**: *(Storage corrected.)* Job events are persisted with the job (`appendJobEvent` in `runtime/persistence.js`) and replayed from there; the design "buffer last 50 events in Redis (`sse:events:{jobId}`)" is not how it currently works (Redis is optional). On reconnect with `Last-Event-ID`, events after that ID are replayed; if the job is already complete, the final `complete` event is sent and the stream closes.
