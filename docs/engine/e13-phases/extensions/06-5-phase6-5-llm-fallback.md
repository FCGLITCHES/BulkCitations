# Phase 6.5: LLM Fallback

> Optional, selective GPT repair of weak/unresolved references. Recovers missing or low-confidence mandatory fields one reference at a time; falls back to a regex heuristic when the hosted call is unavailable or unhelpful.

- **Source:** `server/src/engine/phases/phase6_5LLMFallback.ts`
- **Stage id:** `phase6_5_llm_fallback` · **phaseId:** `llm_fallback` · contract v1
- **Pipeline position:** after P6.8 SharedRepair, before P7 Normalize. Runs on the non-DOI path only (the DOI fast path skips it). Carrier order is unchanged.

## Inputs / Outputs

- **In:** `ReferenceCarrier[]` already typed (P6) and structurally repaired (P6.8).
- **Writes (carrier):**
  - `carrier.fields[*]` — recovered fields with `source: 'llm_fallback'`, origin stage `phase6_5_llm_fallback`. Confidence is recalibrated via `calibrateRecoveredFieldConfidence` (structurally-valid values are lifted to the field's mandatory floor; invalid values are capped at 0.82, floored at 0.55).
  - `carrier.type` — if `doiFastPath` is false and type is still unknown, re-runs `classifyTypeHeuristically`.
  - `carrier.healthEvidence.validSpanFields` — appends each recovered field.
  - `carrier.stageLog` — per-carrier `warning` record (`LLM_LOW_CONFIDENCE`) noting repair source and the missing/low-confidence fields.
  - `ctx.providerUsage.llmTokensUsed` / `ctx.providerUsage.llmRepairCalls` — incremented per hosted call.
  - `ctx.stageLog` — one summary record (`warning` if any repair ran, else `skipped`).

## Selection (which references get repaired)

A carrier is a repair candidate (`shouldRepair`) if **any** of:
- a mandatory field for its type/style schema is missing;
- a present mandatory field is below its `FIELD_CONFIDENCE_THRESHOLDS` gate;
- type is unknown, or style family is `unknown`;
- weak core coverage — fewer than 3 mandatory fields populated, or <60% of the schema's mandatory fields populated.

Non-candidates are skipped untouched.

## Hosted vs heuristic

Per candidate, the stage calls `openaiRepairer` only when `canUseHostedLlmRepair(ctx)` is true; otherwise it calls `heuristicRepairer` directly.

`canUseHostedLlmRepair` = `ENABLE_LLM_FALLBACK` is on **and** the tenant has remaining repair budget. Even when hosted is allowed, `openaiRepairer` falls back to the heuristic (no API call) when:
- type is unknown, or
- schema completeness > 0.8, or
- there are no missing mandatory field names, or
- the API errors, or the model returns `referenceConfidence === 0`.

So the OpenAI call is reserved for typed references with a real, sizeable gap — it is one HTTP request per reference, hence applied sparingly.

**OpenAI call:** `llmService.repair` (`server/src/services/openai.ts`) → Chat Completions, model `OPENAI_MODEL` (default `gpt-5.4-nano`), `temperature: 0`, `max_tokens: 400`, JSON-only response. The prompt passes the raw string, detected type/style, and the list of missing fields; the model may fill all fields if it is >0.85 confident, else only the missing ones.

**Heuristic repairer:** regex extraction over the raw string for authors (pre-year segment), title, year, url, and identifiers (PMID, arXiv, ISBN, ISSN, handle, patent, accessedDate, repository). Reference confidence is 0.86 (≥3 fields filled), 0.74 (1–2), or 0.4 (none).

## Overwrite policy

Recovered values are applied through `canLLMOverwrite`: an `admin_confirmed` field is never overwritten; an existing non-null value is only overwritten when the repair's reference confidence ≥ 0.85 (`LLM_FULL_FILL_CONFIDENCE_THRESHOLD`); otherwise the repair may only fill empty fields. After applying, `syncFieldUncertainty` re-derives uncertainty flags.

## Gating & budgets

- **Parse profile:** enabled only when `executionPolicy.llmFallback === 'debug_only'` (profiles `core_parse_full`, `core_parse_full_enrich`, `debug_full`, `current_runtime`) **and** the request keeps `options.llmFallback` true. `core_parse_fast` and `pro_overlay_enrich` set `llmFallback: 'off'`, which forces `options.llmFallback = false` in `normalizePipelineOptions` — the orchestrator then logs a `skipped` record and the stage never runs.
- **Feature flag:** `ENABLE_LLM_FALLBACK` (default `true`). When false, `canUseHostedLlmRepair` is false and every candidate uses the heuristic path (no hosted client is even constructed).
- **Repair budget** (`getLlmRepairBudget`): admin/internal = unlimited; `pro`/`b2b` tier = `LLM_REPAIR_BUDGET_PRO` (default 50); free tier = `LLM_REPAIR_BUDGET_FREE` (default 10). Budget is consumed per hosted call (`llmRepairCalls`); once exhausted, remaining candidates degrade to the heuristic.
- **Latency budget:** the stage is a budgeted phase. It checks `isStageBudgetExceeded` before each repair and wraps each repair in `runWithRemainingStageBudget`; on timeout it stops processing further carriers and marks the summary as budget-reached.

## Notable specifics

- The OpenAI client is lazily constructed and returns `null` (empty result) when the flag is off or `OPENAI_API_KEY` is unset — failures are swallowed and degrade to the heuristic, never throw into the pipeline.
- Field source `llm_fallback` maps to provenance class `ml` and overwrite priority 4 (see `engine/types/field.ts`).
- This is the only engine stage that issues an external LLM request; it is off by default in production-fast lanes and intended as a bounded recovery path, not the normal extraction route.
