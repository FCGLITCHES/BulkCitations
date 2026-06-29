# ML Runbook

Last verified on 2026-06-25.

This is the short quick-reference runbook. For the full procedures (staging/promotion checklists, troubleshooting, alert response) see [ml-ops-runbook.md](./ml-ops-runbook.md) in this folder — it covers the same material in long form. Keep the two consistent.

The Phase-4 extractor is an ONNX **BiLSTM** token classifier served by the FastAPI ML service on `:8123`. Heuristic extraction is the primary path and always-available fallback; ML is OFF in the default fast lane and only selectively patches heuristic fields when routed.

## Use This Runbook For

- checking ML service health (`GET /v1/ml/health`)
- staging and promoting bundles
- canary and shadow rollout control (`ML_PHASE4_MODE`, `ML_PHASE4_SHADOW_FRACTION`, `ML_PHASE4_PRIMARY_FRACTION`)
- rollback and incident response

## Healthy State

- active bundle loads successfully (`status: ok`, `backend: onnx`, `artifactsReady: true`)
- warmup succeeds (`warmupReady: true`)
- `activeModelVersion` / `featureVersion` match the expected promoted bundle
- runtime mode matches the intended rollout mode

## Degraded State

- service is reachable but serving a fallback or bypass path (`backend: heuristic`)
- bundle load or warmup failed, OR the engine is intentionally in the fast lane (`extractionML: off`) and never calls the model
- rollout should pause until the degradation is understood (unless heuristic/shadow is the deliberate mode)

## Immediate Rollback

1. force the engine to `heuristic` (`ML_PHASE4_MODE=heuristic`; any non-`shadow`/`primary` value resolves to heuristic)
2. verify the effective mode and that extraction is serving from heuristic output
3. stop traffic increases or promotion activity
4. restore the prior promoted bundle if required (`python ml-service/tools/promote_bundle.py <previousVersion>` or pin via `PUT /v1/ml/admin/runtime`)

## Common Failure Categories

- ONNX bundle load failure (missing ONNX/tokenizer/`id2label`, invalid metadata/manifests)
- tokenizer or preprocessing mismatch
- warmup failure
- disagreement spikes in shadow mode
- sustained latency or error spikes

## Operational Rule

If user-visible quality is degraded, favor deterministic fallback first and investigation second. The heuristic path is part of the supported safety model, not a last-minute hack — it is the primary Phase-4 behavior, and ML only augments it.
