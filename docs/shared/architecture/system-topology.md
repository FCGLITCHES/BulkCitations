# System Topology

Last verified on 2026-06-25.

## Repository Components

- `frontend/`
  - Vite and React client (deployed to Vercel)
- `server/`
  - Fastify API, engine runtime, in-process async job runner, persistence, exports, and benchmark tooling (deployed to Render)
- `ml-service/`
  - FastAPI ML microservice (BIO ONNX BiLSTM, port 8123) and local model registry
- `benchmarks/`
  - checked-in benchmark corpus and result artifacts
- `docs/`
  - curated system documentation and legacy technical notes

## Runtime Topology

- Client submits work to the Node API.
- The API runs inspect or convert orchestration.
- Conversion is synchronous by default; large async jobs run **in-process** via `queueMicrotask` scheduled from the runtime-job dispatcher (`server/src/jobs/runtime.ts`). There is no external queue/broker on the request path — BullMQ has been removed.
- The API can call:
  - Postgres for persistence (system of record in production)
  - the Python ML service for ML-backed stages (default-off in the fast lane)
  - external metadata providers (CrossRef / OpenAlex / Retraction Watch / Semantic Scholar) only when `FEATURE_LIVE_ENRICH` is on
  - Cloudflare R2 for export artifact storage (optional)
  - Redis (optional) for auth-revocation checks and the provider / report-limiter caches

## Production Shape

- frontend is served as static assets on **Vercel** (`outputDirectory: dist/public`, SPA rewrites)
- `server/` is the public API on **Render** (Node web service, `node dist/index.js`, health check `/health`)
- `ml-service/` is an internal supporting service
- Postgres is the system of record
- Redis is **optional** — only auth-revocation and short-lived provider/limiter caches; the system runs without it and async jobs do not depend on it
