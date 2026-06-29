# ADR 0005: Use A Single Active Model In V1

Status: Accepted  
Date: 2026-04-05  
Review trigger: Supersede if the serving system adopts multi-model routing or ensemble behavior.

## Decision

Operate with one promoted active ONNX extractor model in v1.

## Context

The repo needs:
- deterministic rollout and rollback
- simple bundle promotion
- simple health reporting
- straightforward eval and shadow comparison

## Alternatives Considered

- multi-model A/B routing
- ensemble extraction
- per-style model families
- simultaneous active and challenger bundles in the main request path

## Consequences

- Promotion, rollback, and model-card maintenance stay simple.
- Shadow analysis compares one candidate path against the baseline rather than multiple competing models.
- The system avoids early complexity in routing, observability, and incident response.

## Why This Holds For V1

Single-model operation keeps the first production ML path understandable and supportable. Multi-model experimentation remains a later optimization once the serving backbone and governance process are stable.

**Status (2026-06-25):** still in effect. The registry serves exactly one active extractor: `resolve_model_dir()` resolves a single bundle dir (`models/current`, or a `MODEL_VERSION_PIN`'d `promoted/`/`staged/` bundle) into one `_extractor` slot (`ml-service/app/models/loader.py`). The several bundles under `models/staged/` and `models/promoted/` are candidate/promotion artifacts, not concurrently routed models — the request path is still single-active with no A/B or ensemble routing.
