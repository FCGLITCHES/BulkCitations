# Redis Usage Policy

Last verified on 2026-06-25 against `server/src/config.ts`, `server/src/redis/*`, `server/src/services/cache.ts`, `server/src/services/reportIpLimiter.ts`, and `server/src/auth/revocation.ts`.

## Decision

Redis is **optional**. The system runs end-to-end without it.

Redis is **not** a queue backend. The earlier BullMQ-on-Redis architecture has been removed: async conversion jobs now run **in-process** via `queueMicrotask` (`server/src/jobs/runtime.ts`), and durable job/workflow state lives in Postgres. No code imports BullMQ (the `bullmq` entry left in `server/package.json` is vestigial and unused).

Postgres is the durable system of record for:

- async conversion job state (including claim/restart recovery via `resumeRuntimeJobs`)
- approved-truth background job state
- review workflow state
- recovery after restart

Redis, when configured, is only an optional accelerator for caching and rate limiting where correctness does not depend on it. When `REDIS_URL`/`UPSTASH_REDIS_URL` is unset, every Redis-backed path falls back to in-memory or no-op behavior.

## Why This Policy Exists

This project is durability-heavy, not queue-throughput-heavy.

The critical workflows are:

- citation parsing
- approved-truth editing and certification
- background refill, Crossref, and certify jobs
- review and recovery flows

Those workflows are safer when the durable job and workflow state live in the same database as the rest of the application data. Keeping Redis non-core removes an entire failure domain that the current workload profile does not need.

## What Redis Is Actually Used For Today

All of these are optional and degrade safely when Redis is absent or errors:

- **Provider and ML result cache** (`server/src/services/cache.ts`). Caches Crossref/OpenAlex/DOI-resolve/ML responses (key patterns and TTLs in `server/src/redis/keys.ts`). Gated by `shouldUseRedisProviderCaches()`: on in `balanced` mode, and forced on (even in `queue_first` mode) when `FEATURE_LIVE_ENRICH` is enabled so repeated DOIs do not re-bill providers. Cache misses fall through to a live lookup.
- **Rate-limit backend** (`server/src/app.ts` via `@fastify/rate-limit`). Used only in production when `shouldUseRedisBackedRateLimits()` is true (production + non-`queue_first` mode). Otherwise the rate limiter uses its in-process store. In development, `skipOnError` keeps requests flowing if Redis is down.
- **Per-IP report limiter** (`server/src/services/reportIpLimiter.ts`). Uses Redis when `shouldUseRedisReportIpLimiter()` is true; otherwise an in-memory per-day counter.

`REDIS_USAGE_MODE` (`queue_first` | `balanced`, default `queue_first`) governs the rate-limit and provider-cache toggles above. The legacy "reserve Redis memory for BullMQ" rationale no longer applies; the mode now simply controls how aggressively optional Redis acceleration is enabled.

## What Must Not Depend On Redis

- request-path correctness
- auth session verification or admin sign-in stability
- durable background work completion
- restart recovery for async jobs
- approved-truth background bulk progress
- admin review persistence

If Redis is unavailable, those workflows must continue to work through Postgres-backed state and application-managed recovery logic.

JWT/session revocation is **process-local in-memory** (`server/src/auth/revocation.ts` uses TTL-keyed `Map`s), not Redis-backed. That keeps Redis off the request path entirely, but revocation entries do not survive a process restart and are not shared across instances. (Redis key helpers for revocation still exist in `server/src/redis/keys.ts` but are not currently wired into the revocation store.)

Session probes also degrade to JWT/profile-backed identity when DB identity-link resolution is temporarily unavailable. That keeps `/internal/admin/session` and `/v1/auth/session` usable during transient backend faults without widening the fallback to the rest of the authenticated API.

## Pros Of Keeping Redis Non-Core

- fewer infrastructure dependencies
- simpler local and production setup
- less risk from Redis outages, auth failures, or memory eviction policy
- no split-brain between queue state and Postgres state
- easier auditing because operational state stays in Postgres
- safer restart and recovery behavior

## Cons Of Keeping Redis Non-Core

- async execution and lease behavior is owned by application code (in-process scheduling + Postgres claims)
- more polling and progress writes hit Postgres
- lower headroom for very high async throughput
- fewer built-in queue features than a dedicated queue would provide
- in-memory revocation and rate limiting are per-process, so multi-instance deployments lose shared state unless Redis-backed paths are enabled

## When Redis Should Be Reconsidered As Core

Redis should only be reconsidered as a core dependency if measured production behavior shows that the in-process / Postgres-backed model is no longer sufficient.

Examples:

- sustained async throughput is high enough to create material Postgres load
- delayed, retried, or fan-out jobs become a dominant workload
- multi-instance deployments require shared revocation or shared rate limiting for correctness
- queue latency requirements become stricter than the in-process model can meet

Until those conditions are proven with production measurements, Redis stays optional.
