# ADR 0003: Use Flat JSONL For The Training Contract

Status: Accepted  
Date: 2026-04-05  
Review trigger: Supersede if training or evaluation contract requirements materially change.

## Decision

Use flat JSONL as the only supported training and evaluation contract in v1.

## Context

The training contract needs to be:
- easy to export from admin workflows
- easy to diff, inspect, and validate
- shared by admin export, fixtures, and offline evaluation
- simple enough for external trainer handoff without repo-coupled object models

## Alternatives Considered

- nested JSON objects
- Parquet
- CSV with field-specific escaping
- database-native trainer reads

## Consequences

- Training and eval data remain human-readable and easy to validate.
- External trainer integration stays simple and tool-agnostic.
- The system avoids introducing a more complex storage format before v1 is stable.
- Some richer nested structures are intentionally flattened at the admin boundary.

## Why This Holds For V1

Flat JSONL optimizes for clarity, portability, and governance. More compact or analytics-oriented formats can be considered later if scale makes them necessary.

**Status (2026-06-25):** still in effect. Training/eval contracts remain flat JSONL (e.g. `ml-service/datasets/citation-bio/review/*.jsonl`, `datasets/engine-v2/gold/real-input/real-input-gold-v1.jsonl`). The line-delimited format is still the shared contract across admin export, fixtures, and offline evaluation.
