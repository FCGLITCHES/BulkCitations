# Operations Plan

Last reviewed: 2026-06-25

## Contents

- [Implemented Baseline](#implemented-baseline)
- [File Plan](#file-plan)
- [Future Planned Work](#future-planned-work)

## Implemented Baseline

- Operations docs are grouped under `docs/operations`.
- Redis policy, deployment config, and security harness docs are centralized in one domain.

## File Plan

| File | Implemented Today | Future Planned Work |
| --- | --- | --- |
| `README.md` | Operations navigation and scope are documented. | Add quick links to runbooks by incident type (auth, quota, DB, ML). |
| `deployment-and-config.md` | Environment/runtime configuration behavior is documented. | Add environment matrix for local/dev/staging/prod with required secrets. |
| `redis-usage-policy.md` | Rewritten: Redis is optional (not a queue backend — BullMQ removed, async runs in-process via `queueMicrotask`); actual optional uses (provider/ML cache, rate-limit + report-IP backends) and in-memory auth revocation are documented. | Add failure-mode matrix proving durable behavior without Redis. |
| `security-harnesses.md` | Pen-test/fuzz/realistic abuse harness flow, coverage, and `security:all` sequencing are documented. | Add required cadence and pass thresholds per release gate. |
| `operations_plan.md` | File-level operations planning is now in-folder. | Add owner + escalation rota links once finalized. |

## Future Planned Work

- Add production readiness checklist:
  - rollback rehearsal
  - DB restore drill
  - auth degradation behavior
  - rate-limit policy validation
- Add observability index for metrics/logs/traces and alert mappings.
- Add background-job resilience playbook for long-running bulk operations.
