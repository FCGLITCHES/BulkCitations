# Error And Response Contracts

Last verified on 2026-06-25 against `server/src/app.ts` and `server/src/routes/*`.

## Standard Error Envelope

All API errors flow through the Fastify error handler in `server/src/app.ts` and use the shared application error shape:

```json
{
  "error": "MACHINE_READABLE_CODE",
  "message": "Human readable explanation",
  "details": {}
}
```

- `error` is a machine-readable code; the concrete codes are defined in `server/src/engine/errors` (`AppError` carries `statusCode`, `code`, and optional `details`).
- `details` is only present when the originating `AppError` set it (e.g. Zod validation issues, quota/limit context).
- For `5xx` responses the `message` is masked to `"An internal error occurred."` and the code is `INTERNAL_ERROR`; in development only, a `stack` field is also included for server errors.
- Unmatched routes return `404` with `{ "error": "NOT_FOUND", "message": "Route not found." }`.
- The rate limiter returns a slightly different shape: `{ "error": "RATE_LIMIT_EXCEEDED", "message": "...", "retryAfter": <seconds> }`.

## Inspect Response

`POST /v1/inspect` returns a preflight response that can include:

- count estimates and split totals
- detected format and format confidence
- detected DOIs
- style hints
- diagnostics and cleanup output
- preview blocks

## Convert Response

Terminal convert responses include:

- `jobId`
- `status`
- `summary`
- `references`
- `failedIndices`
- `duplicateGroups`
- `exports`
- `countAudit`
- `processingPath`
- `providerUsage`
- `warnings`
- `diagnostics`

## Job States

Observed job states in the runtime today are:

- `pending`
- `processing`
- `completed`
- `partial`
- `failed`

`DELETE /v1/jobs/:id` cancellation transitions an in-flight (`pending`/`processing`) job into the `failed` state and sets `error` to `{ code: "JOB_TIMEOUT", message: "Job was cancelled by request." }`. Cancelling an already-terminal job is a no-op that returns the existing status.

## Progress Streaming

There are two related job-progress surfaces, both mounted under `/v1` and `/api/engine`:

- `GET /jobs/:id/stream` returns a single `text/event-stream` payload (a one-shot replay of buffered events since `Last-Event-ID`); it does not hold the connection open.
- `GET /jobs/:jobId/events` is a live Server-Sent Events stream that emits `progress` events on an interval and a terminal `complete` event when the job reaches `completed`/`partial`/`failed`.

## Export Delivery Modes

The export route supports two delivery modes:

- direct
  - response body contains the artifact content
- signed URL
  - response body contains `delivery: "signed_url"`, `downloadUrl`, `fileName`, `contentType`, and `expiresAt` (used when R2 offload is enabled)

## Partial Success Contract

Clients should treat conversion as a partial-success workflow. Even when the request itself succeeds:

- some references may still land in `needs_review` or `needs_action`
- some references may produce warnings
- some references may fail and appear in `failedIndices`

Operationally, `summary` and per-reference `publicStatus` are more important than the top-level HTTP code alone.
