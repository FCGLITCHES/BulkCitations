# Endpoint Reference

Last verified on 2026-06-25 against the routes registered in `server/src/app.ts`.

The engine-runtime routes are registered under **two** prefixes: `/v1` (public) and
`/api/engine` (same handlers, internal/site-default lane). The table lists the `/v1` form.
Asynchronous conversion runs **in-process** (`queueMicrotask` worker in
`server/src/jobs/runtime.ts`) — there is no external job queue / BullMQ.

## Public API

| Method | Route | Purpose |
| --- | --- | --- |
| `POST` | `/v1/inspect` | Preflight ingest, split, format, DOI, and count-audit analysis. |
| `POST` | `/v1/convert` | Convert text or DOI-list input into the target citation style. |
| `POST` | `/v1/convert/upload` | Upload-based convert path; always asynchronous. |
| `GET` | `/v1/jobs/:id` | Return the current job state and any available result payload. |
| `GET` | `/v1/jobs/:id/stream` | Replay buffered job events as a server-sent-event body. |
| `GET` | `/v1/jobs/:id/events` | Live SSE feed (progress + complete) for an in-flight job. |
| `DELETE` | `/v1/jobs/:id` | Cancel in-flight work or return terminal status. |
| `POST` | `/v1/jobs/:id/pro-enrich` | Propose provider overlay fields for a completed job. |
| `POST` | `/v1/jobs/:id/pro-enrich/preview` | Render a corrected preview from selected overlay fields. |
| `POST` | `/v1/jobs/:id/pro-enrich/accept` | Queue accepted overlays for review. |
| `POST` | `/v1/jobs/:id/pro-enrich/apply` | Apply overlays and rescore the affected citations. |
| `GET` | `/v1/export/:jobId/:format` | Download or resolve an export artifact for a completed job. |
| `POST` | `/v1/reports` | Submit a citation failure report (public, rate-limited). |
| `POST` | `/v1/corrections` | Submit a field correction (public). |
| `POST` | `/v1/keys` | Create a new runtime API key (auth required). |
| `GET` | `/v1/keys` | List saved runtime API keys (auth required). |
| `DELETE` | `/v1/keys/:id` | Delete an API key by id (auth required). |
| `GET` / `PUT` | `/v1/history` | Read / replace the caller's conversion-history snapshot (auth required). |

## Key Route Details

### `POST /v1/inspect`

- Runs ingest plus split only.
- Returns:
  - estimated, aggregated, and split counts
  - detected format, format confidence, and detected DOIs
  - structure, style hints, and ingestion signals
  - count audit and cleanup diagnostics
  - optional scored-detection envelope
  - truncated block previews

### `POST /v1/convert`

- Accepts JSON input with `sourceType`, `content`, `outputStyle`, optional `options`, and
  optional `idempotencyKey`.
- Runs synchronously in-process when `estimatedCount <= PIPELINE_SYNC_THRESHOLD`; otherwise
  dispatches an in-process async job.
- Returns either:
  - `200` with a completed `ConvertResponse` (plus `jobAccessToken` and an `enrichment` notice)
  - `202` with queued job metadata (`jobId`, `jobAccessToken`, `status`, `estimatedDuration`,
    `enrichment`)

### `POST /v1/convert/upload`

- Accepts a single multipart file plus optional `outputStyle`.
- Reads the uploaded text into memory, normalizes it, estimates size, enforces quotas, and
  dispatches an in-process job.
- Returns `202` on success.

### `GET /v1/jobs/:id`

- `:id` must be a UUID.
- Returns the current job record as a status response.
- Terminal jobs may include result payloads and exports metadata.

### `GET /v1/jobs/:id/stream`

- Emits replayable SSE event frames from the job's event buffer (one response body).
- Event names include:
  - `queued`
  - `processing`
  - `phase_complete`
  - `complete`
  - `error`
  - `cancelled`

### `GET /v1/export/:jobId/:format`

- Supported formats:
  - `txt`
  - `bib`
  - `ris`
  - `csv`
  - `docx`
- Returns either direct content or a signed download URL, depending on runtime storage mode.

### `POST /v1/keys`

- Requires authentication; body is `{ name, ownerUserId? }` (no `tier` field — the key inherits
  the owner account's tier).
- Creates a runtime key with a `br_live_` prefix.
- The raw secret is returned only at creation time and should be stored securely by the caller.

## Internal Supporting Surfaces

These routes are internal and operational rather than part of the external B2B contract.

| Area | Examples |
| --- | --- |
| Health | `GET /health`, `GET /api/engine/health` |
| Admin review and analytics | `/internal/admin/reports*`, `/internal/admin/corrections*`, `/internal/admin/learning-queue`, `/internal/admin/stats`, `/internal/admin/reprocess/:id`, `/internal/admin/diagnostics/*`, `/internal/admin/review-queue*` |
| Regression execution | `/internal/regression/run`, `/internal/regression/runs` |
| Training and truth governance | `/internal/admin/approved-truth*`, `/internal/admin/training-export`, `/internal/admin/gold-datasets*`, and related admin-truth routes |
| Auth and organization management | `/v1/auth/*` (public: `/auth/session`, `/auth/institutions`), `/v1/org/*`, WorkOS proxy, and webhooks |

Use these routes for internal tooling only unless a separate public contract is written for them.

Approved-truth create and learning-queue promotion have an internal first-save prefill rule: if
the submitted structured truth is empty, the server runs the deterministic local engine prefill
and persists the extracted `expectedFields`, `coreTruth`, and inferred `expectedType` before
saving the approved-truth row. Here `coreTruth` means deterministic local inference from raw
input using parser rules, normalization, structural heuristics, and validated parsing only.

Approved-truth background bulk jobs also accept an internal `pageRange` payload when they run
against filtered rows, so the admin training UI can scope bulk actions to a page window such as
pages 5-12 of the current filtered result set.
