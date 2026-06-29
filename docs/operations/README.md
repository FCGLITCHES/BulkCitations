# Operations

This section focuses on production operation rather than feature design.

## Contents

- `deployment-and-config.md`
  - Environment, topology, and runtime control points.
- `redis-usage-policy.md`
  - Redis is optional, not a queue backend: BullMQ was removed and async jobs run in-process via `queueMicrotask` with durable state in Postgres. Redis only accelerates provider/ML caching and (in some modes) rate limiting; auth revocation is in-memory.
- `security-harnesses.md`
  - Repeatable pen-test, fuzzing, and realistic abuse checks (`server/scripts/security/*`) for runtime security validation.
- `operations_plan.md`
  - File-by-file implemented and future documentation plan.
