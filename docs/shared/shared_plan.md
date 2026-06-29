# Shared Plan

Last reviewed: 2026-06-25

## Contents

- [Implemented Baseline](#implemented-baseline)
- [File Plan](#file-plan)
- [Future Planned Work](#future-planned-work)

## Implemented Baseline

- Shared docs now contain:
  - architecture (`architecture/system-topology.md`)
  - benchmark summaries (`benchmark-results/`)
  - ADRs (`decisions/0001`–`0005`)
  - cross-cutting compatibility/status docs (`cloudflare-workers-compatibility.md`, `implementation-status.md`)
- Decision records and benchmark summaries are no longer split across legacy roots.
- Current-state reminders (verified 2026-06-25): the live pipeline is **17 phases**; async conversion runs **in-process** via `queueMicrotask` (BullMQ/external broker removed); Redis is **optional**; live enrichment is behind `FEATURE_LIVE_ENRICH` (default **off**); deploy target is **Render** (backend) + **Vercel** (frontend) with a separate FastAPI ML service.

## File Plan

| File | Implemented Today | Future Planned Work |
| --- | --- | --- |
| `README.md` | Shared domain navigation exists. | Add contribution rules for cross-domain documents. |
| `cloudflare-workers-compatibility.md` | Compatibility constraints are preserved; queue premise updated for the BullMQ removal (Postgres pooling is now the primary blocker). | Add explicit support matrix by runtime and deployment mode. |
| `implementation-status.md` | Large implementation snapshot is retained. | Split into per-domain status files to reduce drift. |
| `architecture/README.md` | Architecture section entrypoint is documented. | Add architecture decision timeline linking ADR IDs. |
| `architecture/system-topology.md` | System-level topology is documented. | Add sequence diagrams for sync convert vs async jobs. |
| `benchmark-results/README.md` | Benchmark docs entrypoint exists. | Add benchmark artifact retention and naming policy. |
| `benchmark-results/final-internal-results.md` | Curated benchmark summary exists. | Add periodic refresh cadence and baseline comparison deltas. |
| `benchmark-results/methodology.md` | Benchmark methodology is documented. | Add confidence interval/reporting standards and slice definitions. |
| `decisions/0001-use-onnx-runtime-for-v1.md` | ADR retained and relocated. | Add status field (`active`, `superseded`) with review date. |
| `decisions/0002-use-fastapi-as-the-v1-serving-layer.md` | ADR retained and relocated. | Add operational trade-off notes vs alternatives. |
| `decisions/0003-use-flat-jsonl-for-training-contract.md` | ADR retained and relocated. | Add schema evolution/compatibility appendix. |
| `decisions/0004-keep-heuristics-hot-as-primary-fallback.md` | ADR retained and relocated. | Add explicit trigger criteria for fallback enforcement. |
| `decisions/0005-use-a-single-active-model-in-v1.md` | ADR retained and relocated. | Add promotion/rollback evidence checklist. |
| `shared_plan.md` | File-level shared planning is now tracked in-folder. | Keep synchronized with architecture and benchmark changes. |

## Future Planned Work

- Populate `shared/regression/` with cross-domain regression documentation standards.
- Add doc lint ownership for stale links and moved-file detection.
- Establish a quarterly ADR review cycle with explicit acceptance or supersession.
