# ML Ops Runbook

Last reviewed: 2026-06-25
Document owner: BulkReferences Extraction Platform Maintainers

This runbook contains the **detailed** operational procedures for the Phase-4 ML system. It complements, but does not replace, the high-level plan in [ML System Plan](./ml_system_plan.md). `runbook.md` in this folder is the short quick-reference version of the same material; this file is the authoritative long form.

The Phase-4 extractor is an ONNX **BiLSTM** token classifier (see the model card), served by the FastAPI ML service on `:8123`. Heuristic extraction is the primary path and the always-available fallback; ML is OFF in the default fast lane (`core_parse_fast` / `site_default`) and, when routed, only **selectively patches** heuristic fields.

## Scope

Use this runbook for:
- staging and promoting ONNX bundles
- interpreting service health
- executing canary and shadow rollout steps
- rolling back safely
- triaging alerts
- troubleshooting common ONNX, FastAPI, and runtime failures

## Preconditions

Before promoting a candidate bundle:
- the training export contract is unchanged or documented
- the candidate bundle passed bundle validation
- offline eval passed on fixture, reviewed sample, and holdout export
- the model card for the promoted bundle is ready to update
- rollback target is known and available

## Bundle Staging And Promotion

### Staging checklist

- Place the candidate bundle in the staging area defined by the model registry layout.
- Confirm required files exist:
  - ONNX model
  - tokenizer and config
  - `metadata.json`
  - `feature_manifest.json`
  - preprocessing spec
  - optimization manifest
- Record:
  - `modelVersion`
  - `featureVersion`
  - trainer source or commit
  - dataset or export hash

### Promotion checklist

1. Validate the bundle structure and metadata (`python ml-service/tools/validate_bundle.py <stagedDir>`).
2. Run offline evaluation against the required datasets (or confirm manual Review sign-off for the BIO bundle).
3. Confirm shadow disagreement thresholds are acceptable.
4. Promote the bundle:
   - BIO extractor: `POST /admin/bio-bundle/promote` (runs the BIO promotion gate first) or `python ml-service/tools/promote_bundle.py <modelVersion>`. This copies `staged/<v>` → `promoted/<v>` → `current/`.
   - Style bundle: `python ml-service/tools/promote_style_bundle.py <modelVersion>`.
5. Reload or restart the Python ML service so the registry picks up the new `current/` bundle (the loader caches by resolved model dir).
6. Verify health and readiness before any traffic change (`GET /v1/ml/health` → `backend: "onnx"`, expected `activeModelVersion`/`featureVersion`, no `bundleValidationErrors`, `warmupReady: true`).
7. Update the model card with the promoted version details.

The BIO promotion gate hard-blocks only on structural checks (valid bundle, BIO token-classifier metadata, has training rows). Held-out val/test, shadow history, and benchmark-artifact checks are advisory in the single-admin manual-review workflow.

## Health-Check Interpretation

Read health from `GET /v1/ml/health`. The `status` field is `ok` / `degraded` / `unavailable`; `backend` is `onnx` / `heuristic` / `missing`.

### Healthy (`status: ok`, `backend: onnx`)

- ONNX bundle is loaded (`artifactsReady: true`).
- Warmup succeeded (`warmupReady: true`, `warmupError: null`).
- `activeModelVersion` / `featureVersion` match the expected promoted bundle.
- `bundleValidationErrors` is empty.

### Degraded (`status: degraded` or `backend: heuristic`)

- Service is reachable but serving the ML service's internal heuristic fallback.
- ONNX bundle is missing, failed to load, or is intentionally bypassed.
- This is the EXPECTED state in the default fast lane, where the engine sets `extractionML: off` and never calls the model at all.
- Rollout can continue only if the current mode is deliberately heuristic or shadow and the degradation is understood.

### Unavailable (`status: unavailable`)

- Service cannot accept extraction traffic or cannot initialize.
- The engine falls back to heuristic extraction automatically (the heuristic prediction is always computed first).
- Promotion or canary progression must stop until recovery.

## Canary And Shadow Rollout Steps

### Shadow rollout

1. Keep `ML_PHASE4_MODE=shadow`.
2. Verify metrics are flowing for:
  - request latency
  - error rate
  - disagreement on protected fields
  - fallback counts
3. Review shadow disagreement before enabling any primary traffic.

### Primary rollout

1. Start with an explicit primary fraction.
2. Keep the rest of eligible traffic in shadow or heuristic according to policy.
3. Watch:
  - latency percentiles
  - error spikes
  - fallback counts
  - disagreement on `title`, `year`, `doi`, and `authors`
4. Increase primary fraction only after the current window is stable.

## Rollback Steps

### Immediate rollback

1. Force the engine to `heuristic`: set `ML_PHASE4_MODE=heuristic` (or rely on the per-request fast lane, which is already `extractionML: off`). The engine-side Phase-4 override path also resolves to `heuristic` for any non-`shadow`/`primary` value.
2. Confirm the override is reflected in health and metrics (extraction continues from heuristic output, `mlFailureCount`/fallback counts visible in Phase-4 diagnostics).
3. Stop any ongoing traffic increase or promotion workflow.

### Bundle rollback

1. Identify the previous promoted bundle (`ml-service/models/promoted/<version>`).
2. Repoint the active model version: either re-promote the previous version (`python ml-service/tools/promote_bundle.py <previousVersion>`, which rewrites `current/`) or pin it via `PUT /v1/ml/admin/runtime` with `{"modelVersionPin": "<version>"}` (requires `X-ML-Admin-Secret`; the loader resolves the pin from `promoted/`, `staged/`, or the model root).
3. Reload or restart the ML service if you restored `current/` directly.
4. Verify health before leaving fallback mode.

### Post-rollback checks

- Confirm extraction traffic is being served successfully.
- Confirm fallback counts return to expected baseline.
- Capture incident notes, including disagreement or error indicators that triggered rollback.

## Alert Response Checklist

Investigate immediately if any of the following occur:
- latency SLO breach
- inference error spike
- ONNX load failure
- protected-field disagreement breach
- sustained fallback increase
- service memory or CPU runaway

Response sequence:
1. Confirm current effective mode.
2. Confirm active model version.
3. Check whether the issue is isolated to the ML service or upstream inputs.
4. If user impact is active, force `heuristic`.
5. Decide whether bundle rollback is required.
6. Update incident notes and model card or ADRs if the issue changes system understanding.

## Troubleshooting

### ONNX bundle does not load

Check:
- missing ONNX file
- missing tokenizer/config
- missing `id2label`
- invalid `metadata.json` or `feature_manifest.json`
- preprocessing spec mismatch

### FastAPI service starts but stays degraded

Check:
- warmup failure
- path or permissions for `MODEL_DIR`
- runtime dependency mismatch
- CPU or memory starvation

### Shape or tokenizer errors

Check:
- tokenizer files match the exported ONNX model
- truncation and padding rules match the preprocessing spec
- candidate bundle was built against the documented serving contract

### High disagreement in shadow mode

Check:
- dataset drift
- preprocessing mismatch
- wrong promoted bundle or feature version
- unsupported citation styles entering the candidate traffic bucket

## Update Policy

Update this runbook whenever:
- promotion steps change
- rollback procedures change
- health semantics change
- alerting thresholds or key triage signals change
- new recurring failure modes are discovered
