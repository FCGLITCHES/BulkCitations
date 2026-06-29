# E13 Phases

The citation engine phase docs are split to keep core pipeline ownership clear while preserving extension-stage details.

## Contents

- `core/`
  - Canonical Phase 1 through Phase 13 docs.
- `extensions/`
  - Supplemental helper stages (`5.8`, `6.5`, `6.8`).

## Source Alignment

- Runtime implementation: `server/src/engine/phases/*`
- Orchestration entrypoint: `server/src/pipeline/orchestrator.ts`
