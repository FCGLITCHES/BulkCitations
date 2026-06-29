# API Plan

Last reviewed: 2026-06-25

## Contents

- [Implemented Baseline](#implemented-baseline)
- [File Plan](#file-plan)
- [Future Planned Work](#future-planned-work)

## Implemented Baseline

- API docs are grouped under `docs/api`.
- Route references map to the current `server/src/routes/*` implementation.
- Response and error contract docs are separated from endpoint listing.

## File Plan

| File | Implemented Today | Future Planned Work |
| --- | --- | --- |
| `README.md` | API section navigation and scope boundary are documented. | Add versioning policy once `v2` routes are introduced. |
| `api-contracts.md` | Canonical request/response model notes are preserved from legacy root docs. | Split by public vs internal contracts and add JSON examples per route. |
| `b2b-overview.md` | B2B usage model, sync/async (in-process `queueMicrotask`) behavior, tier list (`anonymous`/`free`/`pro`/`b2b`) with guardrail defaults, and enrichment gating are documented. | Add a per-route limit matrix and worked request/response examples. |
| `endpoints.md` | Route-by-route references exist for current API surfaces. | Add deprecation labels and migration notes for any contract-breaking changes. |
| `error-and-response-contracts.md` | Shared envelope semantics, 5xx masking, rate-limit/404 variants, job states, cancellation, both progress-streaming surfaces, and export delivery are documented. | Add explicit retry/idempotency guidance and SSE error-state examples. |

## Future Planned Work

- Add an API changelog section tied to release tags.
- Add contract test pointers (`server` test paths) per endpoint.
- Add operational SLA/SLO references after policy finalization.
