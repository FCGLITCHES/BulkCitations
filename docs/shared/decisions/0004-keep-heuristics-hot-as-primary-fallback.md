# ADR 0004: Keep Heuristics Hot As The Primary Fallback

Status: Accepted  
Date: 2026-04-05  
Review trigger: Supersede only if the system deliberately removes heuristic fallback as a product decision.

## Decision

Keep heuristic extraction permanently loaded and immediately available, including when ML runs in `primary` mode.

## Context

The system must preserve reliability while introducing ML authority gradually. Phase-4 extraction operates under real traffic, bundle promotion, and model-health uncertainty.

## Alternatives Considered

- hard cutover to ML with no heuristic fallback
- cold-start heuristic fallback only on severe incidents
- parallel dual-authority output with no single fallback path

## Consequences

- `primary` does not mean “heuristics are gone.”
- Unsupported styles, health issues, model errors, and rollout problems can degrade safely to heuristics.
- Rollback becomes simpler and faster.
- Operators keep a stable baseline even while evaluating new ONNX bundles.

## Why This Holds For V1

The repo already depends on heuristics as the baseline extractor. Removing that safety net before the ML path is fully proven would increase rollout risk for no v1 benefit.

**Status (2026-06-25):** still in effect — more true than ever. `ML_PHASE4_MODE` defaults to `heuristic` (`server/src/config.ts`), the benchmark fast lane forces ML off (`server/src/benchmark/runProfile.ts` sets `ML_PHASE4_MODE = "heuristic"`), and heuristic extraction remains the primary path with ML in `shadow`/`primary` only when explicitly enabled.
