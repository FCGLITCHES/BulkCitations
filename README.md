# BulkReferences

> **📌 Status note — updated 2026-06-25.** This document predates recent engineering work; parts below are point-in-time. Key changes since: the **BullMQ** queue layer described here was vestigial and has been **removed** (the live async path is in-process `queueMicrotask`); **enrichment is enabled** behind `FEATURE_LIVE_ENRICH` (+cache+budget); **AMA / ACS / Chicago-notes** render natively (no APA fallback); **pages, ISBN, and author-parsing** are fixed; health now flags confident-wrong fields; the **DeterministicResolver** DOI migration has started. See **[System Assessment](docs/engine/system-assessment.md)** for the live status.


BulkReferences is a citation converter: it ingests messy bibliographies and rendered references and returns clean, style-correct citations. It is split into four deployable parts:

- `frontend/`: Vite + React client (single-page app; dev port `2397`, build output `frontend/dist/public`)
- `server/`: Fastify API and the citation engine runtime (17-phase pipeline under `server/src/engine/phases/`)
- `ml-service/`: FastAPI microservice (port `8123`) for ONNX BiLSTM BIO extraction, style detection, and ingest helpers
- `docker-compose.yml`: local Postgres (required) and Redis (optional)

Auth is Clerk + WorkOS, persistence is Postgres via Drizzle, and the optional LLM repair path uses OpenAI `gpt-5.4-nano`. The async conversion path runs in-process via `queueMicrotask`; there is no external queue worker, and async/approved-truth jobs recover from Postgres rather than depending on Redis.

## Documentation

- `docs/README.md`: top-level documentation index
- `docs/api/`: B2B API documentation
- `docs/engine/`: engine phase documentation (and `docs/engine/system-assessment.md` for live status)
- `docs/ml-system/`: ML architecture and operations
- `docs/frontend/`, `docs/governance/`, `docs/operations/`, `docs/shared/`: domain references

## Local Development

1. Copy `.env.example` to `.env` and adjust values if needed.
2. Start infrastructure (Postgres + optional Redis):

```bash
pnpm infra:up
```

3. Start everything (server, frontend, and ML service) with one command:

```bash
pnpm dev
```

This launches the API on port `4000`, the frontend on `2397`, and the ML service on `8123`. (`npm run dev` runs the same launcher; pnpm is the repo's configured package manager.)

`PERSISTENCE_BACKEND=database` is the local and production runtime default.
Transient test persistence is internal-only and is not a supported operator setting for app sessions.
`pnpm dev` no longer silently downgrades to transient non-durable persistence when Postgres is unavailable; it fails fast so admin/training data cannot appear to save and then disappear later. When Redis is unavailable it simply disables Redis-backed queues for that session and keeps running.
Live enrichment is gated behind `FEATURE_LIVE_ENRICH` (default off) and the ML fast lane defaults to heuristic-only, so local conversion stays off external OpenAI / enrichment paths unless you explicitly opt in.

## Frontend API Boundary

Frontend API requests now resolve through `VITE_API_BASE_URL` when they target the API service.

- Leave it empty for same-origin production or for Vite proxy-based local development.
- Set it to something like `https://api.example.com` when the frontend and API are deployed separately.

This now covers:

- public/auth routes such as `/v1/auth/*`
- engine routes such as `/v1/*`
- admin routes such as `/internal/admin/*`
- supported site-level API routes such as `/api/contact`

## Production Topology

- The frontend deploys to **Vercel** as a static SPA (`outputDirectory: dist/public`, with a catch-all rewrite to `/index.html`).
- The `server/` API deploys to **Render** (`bulkreferences-api` web service; `npm install && npm run build`, start `node dist/index.js`, health check `/health`).
- Run `ml-service/` as a separate internal service reachable from the API via `ML_SERVICE_URL`.
- Use Postgres for persistence.
- Redis is optional. Async conversion jobs and approved-truth background jobs recover from Postgres instead of depending on a queue worker.

Recommended production defaults:

- `NODE_ENV=production`
- `PERSISTENCE_BACKEND=database`
- `VITE_API_BASE_URL=https://your-api-hostname`
- `DATABASE_URL`, `SESSION_SECRET`, and provider credentials set explicitly

## Verification

- API build: `pnpm build:server`
- Frontend build: `pnpm build:frontend`
- Server tests: `pnpm test:server`
