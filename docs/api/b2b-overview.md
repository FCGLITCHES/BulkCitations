# B2B API Overview

Last verified on 2026-06-25 against `server/src/routes/*`, `server/src/config.ts`, and `server/src/runtime/guardrails.ts`.

## Purpose

BulkReferences exposes a citation-conversion API for high-volume or embedded workflows. The primary public surface lives under `/v1/*` and supports:

- previewing and auditing incoming citation batches
- converting citation batches into a requested output style
- polling or streaming long-running jobs
- downloading export artifacts
- creating and managing runtime API keys

## Primary Entry Points

- `POST /v1/inspect`
  - Preflight analysis of incoming content before conversion.
- `POST /v1/convert`
  - Main conversion endpoint for raw text or DOI-list payloads.
- `POST /v1/convert/upload`
  - Multipart upload path that always queues async work.
- `GET /v1/jobs/:id`
  - Polling endpoint for queued work.
- `GET /v1/jobs/:id/stream`
  - One-shot replay of buffered job events as a `text/event-stream` body.
- `GET /v1/jobs/:jobId/events`
  - Live Server-Sent Events stream for queued work (interval `progress` + terminal `complete`).
- `DELETE /v1/jobs/:id`
  - Cancels an in-flight job (marks it `failed`).
- `GET /v1/export/:jobId/:format`
  - Export retrieval for completed jobs.
- `POST /v1/keys`
  - API key creation (also `GET /v1/keys`, `DELETE /v1/keys/:id`; these require an authenticated user).

> All engine-runtime routes are also mounted under the `/api/engine` prefix in addition to `/v1`.

## Input Expectations

- `content` is capped at `5000000` characters (`CITATION_TEXT_INPUT_MAX_CHARS` in `server/src/routes/requestLimits.ts`); the JSON body limit is `10000000` bytes.
- Supported convert request source types are defined by the runtime enums in `server/src/engine/types/runtime-enums.ts`.
- Upload requests are normalized into either the `text` or `doi_list` lane.
- A pure DOI-per-line upload is treated as a DOI-list fast path.

## Execution Model

- Synchronous path
  - `POST /v1/convert` stays synchronous when `estimatedCount <= PIPELINE_SYNC_THRESHOLD`.
  - The checked-in default threshold is `500` references (`PIPELINE_SYNC_THRESHOLD` in `server/src/config.ts`).
- Asynchronous path
  - `POST /v1/convert` queues async work (HTTP `202`) when the estimated count exceeds the threshold.
  - `POST /v1/convert/upload` always queues async work.
  - Async jobs run **in-process** via `queueMicrotask` (see `server/src/jobs/runtime.ts`); there is no external queue/worker (BullMQ was removed). Durable job state lives in Postgres, so the database backend supports restart recovery (`resumeRuntimeJobs`).

## Authentication And Tenancy

- Session and bearer (Clerk/WorkOS JWT) auth support exist for product users.
- API keys are also supported when `AUTH_ALLOW_API_KEYS=true` (default on).
- The runtime recognizes four tiers: `anonymous`, `free`, `pro`, and `b2b`. Unauthenticated callers resolve to `anonymous`; API keys and accounts resolve to `free`/`pro`/`b2b`.
- Tier affects daily reference quotas and concurrent async-job limits through `server/src/runtime/guardrails.ts`. Defaults: daily refs `anonymous: 10`, `free: 50`, `pro: 10000`, `b2b: B2B_DAILY_REF_LIMIT` (50000); concurrent async jobs `anonymous: 1`, `free: 2`, `pro: 10`, `b2b: B2B_ORG_CONCURRENT_JOB_LIMIT` (25) with a global B2B ceiling (`B2B_GLOBAL_CONCURRENT_JOB_LIMIT`, 100).
- Admin requests bypass quota and concurrency guardrails.

## Important Runtime Notes

- Live provider enrichment (Phase 8) is gated by the `FEATURE_LIVE_ENRICH` kill-switch (default **off**). While off, `/convert` forces `enrich` to `false` regardless of `options.enrich` or tier, so no live Crossref/OpenAlex/Semantic Scholar traffic occurs. When on, enrichment is tier-gated: `pro`/`b2b` are unlimited, and `free`/`anonymous` get a one-time lifetime trial of 10 enriched references (`FREE_ENRICHMENT_LIFETIME_REFS`); batches larger than the remaining free allowance are treated as Pro-only "bulk". The convert response carries an `enrichment` notice describing what was applied.
- Async job cancellation marks a job as `failed` with a cancellation error payload rather than deleting history.
- Export delivery may be:
  - direct binary content
  - a signed URL (`delivery: "signed_url"`) when R2 offload is enabled

## What B2B Consumers Should Assume

- The API is batch-oriented and designed for partial success rather than all-or-nothing failure.
- A successful HTTP request does not imply every citation converted cleanly; clients should inspect `summary`, `failedIndices`, `warnings`, and per-reference status.
- Job status and export retrieval are part of the normal integration path for larger batches.
