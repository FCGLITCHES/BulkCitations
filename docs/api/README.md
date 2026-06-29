# API Documentation

This section documents the B2B and integration-facing API surface exposed by the Fastify service in `server/`. The public conversion API lives under `/v1/*` (and is mirrored under `/api/engine/*`): preflight inspect, sync/async convert, in-process async jobs with polling and SSE, export retrieval, and API-key management.

## Contents

- `b2b-overview.md`
  - What the API is for, the entry points, sync-vs-async execution (in-process `queueMicrotask`), input limits, tiers/guardrails, and enrichment gating.
- `endpoints.md`
  - Route-by-route reference for the currently implemented public API and the supporting internal admin surfaces.
- `api-contracts.md`
  - Canonical request/response model notes carried over from the legacy root docs.
- `error-and-response-contracts.md`
  - Shared error envelope, job states, cancellation, both progress-streaming surfaces, and export delivery behavior.
- `api_plan.md`
  - File-by-file implemented and future documentation plan.

## Live Source Files

- `server/src/routes/inspect.ts`
- `server/src/routes/convert.ts`
- `server/src/routes/jobs.ts`
- `server/src/routes/sse.ts`
- `server/src/routes/export.ts`
- `server/src/routes/keys.ts`

## Scope

This folder focuses on the live HTTP contract, not front-end behavior or future product packaging. Commercial packaging, SLA, and pricing decisions should be documented separately when finalized.
