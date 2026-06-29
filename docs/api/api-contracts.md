# BulkReferences API Contracts

Last verified on 2026-06-25 against `server/src/routes/*`, `server/src/runtime/*`, and `server/src/engine/types/api.ts`.

The engine runtime routes below are registered under **both** `/v1` and `/api/engine`
(see `server/src/app.ts`). Examples use `/v1`; substitute `/api/engine` for the
internal/site-default lane. Asynchronous work runs **in-process** (a `queueMicrotask`
worker in `server/src/jobs/runtime.ts`); there is no external job queue / BullMQ.

## Public v1

### `POST /v1/inspect`

Request:

```json
{
  "sourceType": "text",
  "content": "..."
}
```

`sourceType` accepts `text`, `pdf`, `docx`, `txt`, `bib`, `ris`, `doi_list`.
`content` is `1..5000000` characters.

Response (`InspectResponse`):

- `estimatedCount`
- `aggregatedCount`
- `splitCount`
- `countAudit`
- `detectedFormat`
- `detectedDois`
- `formatConfidence`
- `structure`
- `styleHints`
- `ingestionSignals`
- `needsActionCount`
- `diagnostics`
- `detection` (present when scored detection ran)
- `cleanup` (PDF-copy cleanup decision)
- `blocks` (truncated per-block previews)

### `POST /v1/convert`

Request:

```json
{
  "sourceType": "text",
  "content": "...",
  "outputStyle": "apa7",
  "options": {
    "parseProfile": "core_parse_full",
    "enrich": true,
    "dedup": true,
    "groupDuplicates": true,
    "debug": false
  },
  "idempotencyKey": "optional-string"
}
```

- `sourceType` is `text` or `doi_list`.
- `outputStyle` defaults to `apa7`. Supported: `apa7`, `mla9`, `chicago-author-date`,
  `chicago-notes-bib`, `vancouver`, `ieee`, `harvard-ctr`, `ama`, `acs` (`auto`/`unknown`
  also accepted).

Behavior:

- Returns `200` with a `ConvertResponse` when `estimatedCount <= PIPELINE_SYNC_THRESHOLD`
  (synchronous in-process run).
- Returns `202` with `{ jobId, jobAccessToken, status: "pending", estimatedDuration, enrichment }`
  when the count is above the threshold. The job is dispatched immediately to the in-process
  microtask worker — it is not handed to an external broker.
- `options.parseProfile` is the canonical execution contract for the core parser. Only the
  non-enriching core lanes (`core_parse_fast`, `core_parse_full`) are honored from a client;
  any other requested profile is coerced to `core_parse_full`. `/v1/convert` defaults to
  `core_parse_full` when `parseProfile` is omitted.
- `options.enrich` is accepted but only takes effect when inline enrichment is actually
  allowed. Inline enrichment requires `FEATURE_LIVE_ENRICH=true` (default **off**) **and** a
  passing tier allowance (Pro/B2B unlimited; free/anonymous get a 10-reference lifetime trial,
  bulk batches are Pro-only). When allowed, the server upgrades the profile to
  `core_parse_full_enrich`. With the flag off, no live provider traffic runs.

`ConvertResponse` (200) includes:

- `jobId`
- `jobAccessToken`
- `status`
- `executionProfile`
- `coreParseLatencyMs`
- `summary` (`total`, `ready`, `needsReview`, `needsAction`, `failed`, `parseQuality`)
- `references`
- `failedIndices`
- `duplicateGroups`
- `exports` (`{ format, available }[]`)
- `countAudit`
- `processingPath`
- `providerUsage`
- `overlay`
- `warnings`
- `diagnostics`
- `enrichment` (added by the route; a user-facing notice — see below)
- `retryPayload` (optional)

`overlay` is present even when no provider work runs:

```json
{
  "status": "not_requested",
  "jobId": null,
  "providerLatencyMs": null
}
```

`enrichment` is a notice describing whether inline enrichment applied and the free-trial state,
e.g.:

```json
{
  "applied": false,
  "tier": "free",
  "reason": "no_identity",
  "message": "Enrichment is a Pro feature. Sign in to use your 10 free reference enrichments, or upgrade to Pro."
}
```

### `POST /v1/convert/upload`

Multipart request:

- `file` (single file; max `UPLOAD_MAX_BYTES`, default 2,000,000 bytes)
- optional `outputStyle`

Behavior:

- Always returns `202` with `{ jobId, jobAccessToken, status, estimatedDuration }` and runs the
  job on the in-process worker.
- Uploaded text is normalized into the `text` lane, or the `doi_list` fast path when every line
  is a bare DOI. The upload lane always uses `parseProfile: core_parse_full`.

### `GET /v1/jobs/:id`

`:id` must be a UUID. Response (`JobStatusResponse`):

- `jobId`
- `status` (`pending` | `processing` | `completed` | `partial` | `failed`)
- `executionMode` (`sync` | `async`)
- optional `executionProfile`
- optional `coreParseLatencyMs`
- optional `progress`
- optional `summary`
- optional `countAudit`
- optional `references`
- optional `exports`
- optional `overlay`
- optional `warnings`
- optional `diagnostics`
- optional `error`

### `GET /v1/jobs/:id/stream`

- Returns `text/event-stream`.
- Replays the buffered events for the job (a single response body, honoring `Last-Event-ID`),
  including `queued`, `processing`, `phase_complete`, `complete`, `error`, and `cancelled`.

> A separate live SSE feed is available at `GET /v1/jobs/:jobId/events`, which streams
> `progress` and `complete` frames by polling the in-process job until it finishes.

### `DELETE /v1/jobs/:id`

Response:

- `jobId`
- `status`

Cancellation transitions an in-flight job to `failed` (with a `JOB_TIMEOUT` cancellation error);
terminal jobs are returned unchanged.

### `GET /v1/export/:jobId/:format`

Supported formats:

- `txt`
- `bib`
- `ris`
- `csv`
- `docx`

Behavior:

- Generates exports lazily on first request, except `txt`, which is also persisted eagerly for
  completed jobs.
- Returns the artifact body directly, or `{ delivery: "signed_url", downloadUrl, fileName,
  contentType, expiresAt }` when R2 offload is enabled.

### `POST /v1/jobs/:id/pro-enrich`, `/preview`, `/accept`, `/apply`

Authenticated Pro-overlay endpoints that propose, preview, accept, and apply provider-sourced
field overlays onto a completed job's references. All return `200` with overlay metadata. See
`server/src/routes/proEnrich.ts`.

### `POST /v1/reports`

Public feedback endpoint (registered on the engine-runtime lane, not admin). Request:

```json
{
  "jobId": "job-id",
  "citationId": "citation-id",
  "failureCategory": "metadata_mismatch",
  "userNote": "optional note",
  "optInTraining": false
}
```

Returns `201` with the stored report. Rate-limited per IP.

### `POST /v1/corrections`

Public feedback endpoint. Request:

```json
{
  "jobId": "job-id",
  "citationId": "citation-id",
  "fieldName": "title",
  "newValue": "Corrected title",
  "optInTraining": false
}
```

`fieldName` must be one of the extracted-field keys. `newValue` is an arbitrary value (string,
array of authors, year, etc.). Returns `201` with the stored correction.

### `POST /v1/keys`

Requires authentication. Request:

```json
{
  "name": "My key",
  "ownerUserId": "uuid-optional"
}
```

`tier` is **not** a request field — the key inherits the owner account's tier. `ownerUserId`
defaults to the caller; only admins may mint keys for another user.

Response (`201`):

- `id`
- `userId`
- `name`
- `prefix` (the `br_live_` prefix slice)
- `tier`
- `rawKey` (returned only at creation time)
- `createdAt`

### `GET /v1/keys`

Requires authentication. Returns the array of persisted runtime API keys
(scoped to the caller unless an admin).

### `DELETE /v1/keys/:id`

Requires authentication. Response:

- `id`
- `deleted`

### `GET /v1/history`, `PUT /v1/history`

Authenticated per-user conversion-history sync (client-owned snapshot). `GET` returns
`{ items }`; `PUT` replaces the stored snapshot.

## Internal Admin

Registered under `/internal` and gated by `requireAuth` + `requireAdmin`.

### `GET /internal/admin/reports`

- Lists submitted reports.

### `PATCH /internal/admin/reports/:id`

Request:

```json
{
  "status": "accepted"
}
```

(The admin report surface also exposes assign / comment / reject / resolve sub-routes.)

### `GET /internal/admin/corrections`

- Lists submitted corrections.

### `PATCH /internal/admin/corrections/:id`

Request:

```json
{
  "status": "approved"
}
```

Behavior:

- Approving a correction applies it to the citation and emits a citation-version snapshot.

### `GET /internal/admin/learning-queue`

- Lists queued learning items derived from reports and corrections.

### `GET /internal/admin/stats`

- Returns aggregate job, citation, correction, and queue counts from the runtime store.

### `POST /internal/admin/reprocess/:id`

- Re-runs the pipeline on the citation raw text and preserves existing confirmed field values.

> The admin surface also includes diagnostics (`/admin/diagnostics/*`), the review queue,
> egress reporting, the Phase-4 mode switch, and the approved-truth / training governance
> routes in `server/src/routes/adminTruthRoutes.ts`. These are internal tooling, not part of
> the public contract.

## Internal Regression

Registered under `/internal` (admin-gated).

### `POST /internal/regression/run`

- Runs all seeded regression suites and returns the run result (`200`).
- Also writes a markdown report under `docs/test-results/`.

### `GET /internal/regression/runs`

- Lists in-memory regression run history, including the generated markdown path.

## Error Envelope

All error responses use the same shape:

```json
{
  "error": "MACHINE_READABLE_CODE",
  "message": "Human readable explanation",
  "details": {}
}
```

`details` is present only when an `AppError` carries it. For `5xx` errors the message is masked
to `"An internal error occurred."`. Codes are defined in
`server/src/engine/errors/codes.ts`.
