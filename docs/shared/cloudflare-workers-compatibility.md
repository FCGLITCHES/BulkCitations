# Cloudflare Workers Compatibility (Backend)

## Summary

The `server/` backend is a **Fastify (Node.js)** application that depends on multiple **Node-only** APIs and libraries. It is **not** currently deployable to Cloudflare Workers without substantial refactoring or a full rewrite.

Current production topology (and the recommended near-term shape):

- **Frontend**: static Vite build on **Vercel** (Cloudflare Pages is an equivalent alternative)
- **Backend**: Fastify on a Node host — currently **Render**
- **ML service**: separate Python (FastAPI) service reachable from the backend

Workers migration can be revisited later as a dedicated project.

## Why Workers is not viable right now

Cloudflare Workers runs an edge runtime that does not support most Node built-ins and expects a Fetch API style architecture. The current backend uses:

- **Postgres driver + ORM**: `pg`, `drizzle-orm` (Node networking + connection pooling)
  - `server/src/db/connection.ts` (`new pg.Pool(...)`)
  - this is the primary blocker: the system of record relies on a Node TCP connection pool
- **Node built-ins**:
  - `node:crypto` (UUIDs, hashing, key generation)
  - `node:fs/promises` (regression runner writes markdown output)
  - `process.*` signals/env usage
  - examples:
    - `server/src/middleware/auth.ts`
    - `server/src/routes/keys.ts`
    - `server/src/regression/runner.ts`

These are fundamental to the current architecture (persistence, key generation, filesystem output), not incidental.

> **Queue premise update (2026-06-25):** the original blocker list cited an external **BullMQ + ioredis** job queue. That queue has since been **removed** — async conversion now runs **in-process** via `queueMicrotask` scheduled from `server/src/jobs/runtime.ts`, with Postgres as the durable claim store. There is no longer a Redis-backed broker on the request path. Redis is now **optional** (auth-revocation checks and short-lived provider/limiter caches only); `ioredis` remains a dependency for those optional paths but is not required to run the core runtime. This removes one historical Workers blocker, but the assessment below is unchanged because the Postgres pooling and Node-API constraints still hold.

## Options

### Option A: Cloudflare Workers (Node compat flag)

May work for some Node APIs, but **does not solve** the Postgres connection-pooling constraint in the Workers environment. Treat as experimental.

### Option B (recommended now): Keep backend on Node, move frontend only

Low risk and aligns with existing boundary via `VITE_API_BASE_URL` (frontend can call a separate API hostname).

### Option C: Rewrite API as Workers

Long-term best if you want full edge-native backend, but requires redesign:

- Replace `pg` pooling with Workers-appropriate DB access patterns (Hyperdrive, a serverless Postgres driver, or HTTP DB access) — the main remaining blocker
- Re-home the in-process `queueMicrotask` async runner onto Workers-native queues/workflows (the in-process model also does not fit the per-request edge isolate lifecycle)
- Replace Node filesystem writes
- Replace token/session flows to match edge constraints

## Cloudflare Pages Notes

- Frontend builds to static assets; configure `VITE_API_BASE_URL` to point at the Node-hosted API.
- Backend must allow Pages preview and production origins via CORS.

