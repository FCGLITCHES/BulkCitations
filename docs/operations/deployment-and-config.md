# Deployment And Configuration

> **📌 Status note — updated 2026-06-25.** This document now describes the live deployment: **Render** hosts the backend (`bulkreferences-api`) and **Vercel** hosts the frontend. The earlier Hetzner/VPS topology is gone. The **BullMQ** queue layer was vestigial and has been **removed** — the live async path is in-process `queueMicrotask`, and **Redis is optional** (provider cache / optional rate limiting only; it is not a required queue backend). Other recent changes: **enrichment** is gated behind `FEATURE_LIVE_ENRICH` (+cache+budget); **AMA / ACS / Chicago-notes** render natively (no APA fallback); **pages, ISBN, and author-parsing** are fixed; health now flags confident-wrong fields. See **[System Assessment](../engine/system-assessment.md)** for the live engine status.

Last verified on 2026-06-25 against `render.yaml`, `frontend/vercel.json`, `server/src/config.ts`, and `.env.example`.

## Local Development Baseline

- `pnpm infra:up` — starts local Postgres + Redis via `docker-compose.yml` (Redis is optional; see below).
- `pnpm dev` — runs server, frontend, and ML service together.
- `pnpm dev:ml` — ML service only (FastAPI/uvicorn on `:8123`).

## Production Topology

- **Frontend → Vercel.** Built with Vite; `frontend/vercel.json` sets `outputDirectory: dist/public` and rewrites all routes to `/index.html` (SPA).
- **Backend → Render.** `render.yaml` defines the `bulkreferences-api` web service: Node runtime, `rootDir: server`, build `npm install && npm run build`, start `node dist/index.js`, health check at `/health`. `SESSION_SECRET` is provisioned via `generateValue: true` (or set manually if the service was created outside the Blueprint).
- **ML service (`ml-service/`)** runs as an internal service the backend reaches through `ML_SERVICE_URL`. If it is unavailable the API degrades via the Phase-4 circuit breaker rather than failing.
- **Postgres** is the durable system of record. **Redis is optional** — the runtime no longer requires it for async work.
- **Async is in-process.** Conversion and background jobs run inside the API process via `queueMicrotask` (see `server/src/jobs/runtime.ts`, `routes/adminTruthRoutes.ts`, `admin/batchHealthSummary.ts`). There is no separate worker process to deploy. Large requests above `PIPELINE_SYNC_THRESHOLD` take the async job path; everything else runs synchronously in the request.

## Important Environment Groups

(Names below mirror `server/src/config.ts`; `.env.example` is the canonical reference.)

- core runtime
  - `NODE_ENV`
  - `PORT` (Render injects its own `PORT`; default `3111`)
  - `PERSISTENCE_BACKEND` (`auto` | `database`)
  - `CORS_ALLOWED_ORIGINS`
- database
  - `DATABASE_URL`
  - `DATABASE_SSL_MODE`, `DATABASE_SSL_REJECT_UNAUTHORIZED`, pool/timeout settings
- redis (optional)
  - `REDIS_URL` / `UPSTASH_REDIS_URL` (TCP); `UPSTASH_REDIS_REST_*` (REST helper only)
  - `REDIS_PROVIDER`, `REDIS_USAGE_MODE` (`queue_first` | `balanced`)
- pipeline (async runs in-process, not on Redis)
  - `PIPELINE_BATCH_SIZE`, `PIPELINE_MAX_CONCURRENCY`, `PIPELINE_SYNC_THRESHOLD`
  - `PIPELINE_FAST_WORKERS_ENABLED`, `PIPELINE_STAGE_BUDGET_MS`
  - `B2B_DAILY_REF_LIMIT`, `B2B_ORG_CONCURRENT_JOB_LIMIT`, `B2B_GLOBAL_CONCURRENT_JOB_LIMIT`
- ML runtime
  - `ML_SERVICE_URL`, `ML_SERVICE_TIMEOUT_MS`, `ML_ADMIN_SECRET`
  - `ML_PHASE4_MODE`, plus circuit-breaker and ML-side concurrency/queue limits
- auth
  - `SESSION_SECRET`, `AUTH_MODE`
  - `AUTH_ALLOW_LEGACY_SESSIONS`, `AUTH_ALLOW_API_KEYS`
  - Clerk and WorkOS JWKS/issuer/audience settings
- external providers
  - `OPENAI_API_KEY`, `OPENAI_MODEL`
  - `CROSSREF_EMAIL`, `SEMANTIC_SCHOLAR_API_KEY`
- feature flags
  - `FEATURE_LIVE_ENRICH`, `FEATURE_PDF_CLEANUP`, `ENABLE_LLM_FALLBACK`, `FEATURE_SCORED_DETECTOR`
- storage
  - `R2_*` and `EXPORT_R2_OFFLOAD_*` settings

## Production Defaults Recommended By The Repo

- `NODE_ENV=production`
- `PERSISTENCE_BACKEND=database` (the `auto` default already resolves to the database when `DATABASE_URL` points at a reachable Postgres)
- explicit `DATABASE_URL`
- explicit `SESSION_SECRET` (the dev placeholder is rejected at boot in production — see `config.ts`)
- explicit provider credentials
- `REDIS_URL` is **optional**. Leave it unset to run without Redis. Set it only when you want the provider cache or Redis-backed rate limiting; if both `REDIS_URL` and `UPSTASH_REDIS_URL` are set they must match.

## Persistence Guardrail

- `PERSISTENCE_BACKEND` accepts `auto` (default) or `database`. There is no operator-supported `memory` mode.
- `auto` resolves to durable database persistence when Postgres is reachable; `database` forces it.
- Transient in-memory persistence is internal to isolated test runs and is not an operator-supported app mode.
- `pnpm dev` fails fast if the configured local Postgres target is unavailable instead of silently downgrading the session to in-memory persistence.

## Redis Usage Modes (Optional)

Redis is not required. When `REDIS_URL` is unset, `getRedis()` is never called on a hot path and every Redis-backed helper degrades to its in-process fallback. When Redis **is** configured, `REDIS_USAGE_MODE` controls how much it is used:

- `queue_first` (default): conserves a small/constrained Redis plan. The Fastify Redis rate-limit store, provider/result caching, and the report-per-IP Redis counter are **off** (the report limiter falls back to an in-process limiter). The persistent provider cache is still enabled when `FEATURE_LIVE_ENRICH=true`, so repeated DOIs do not re-bill Crossref/OpenAlex.
- `balanced`: additionally enables Redis-backed API rate limiting and provider caches. Use it only when you have memory headroom.

Note: the mode name is historical. There is no BullMQ queue to reserve memory for — `queue_first` today simply means "minimal Redis footprint." Auth JWT/session **revocation is process-local** (an in-memory map in `server/src/auth/revocation.ts`), so it never depends on Redis in either mode.

## Operational Reminder

The checked-in `.env.example` is the current reference for variable names and defaults. If runtime configuration changes, update `.env.example` and this page together.
