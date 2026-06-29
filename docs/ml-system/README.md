# ML System

This section documents the current in-repo ML serving and governance model.

The ML system is a local FastAPI service (`:8123`) that serves an ONNX **BiLSTM** BIO citation field extractor plus local style/type decisions. It is consumed by the engine's Phase 4. Heuristic extraction is the primary path and the always-available fallback; the ML extractor is OFF in the default fast lane and only selectively patches heuristic fields when routing enables it (`ML_PHASE4_MODE != heuristic`).

## Contents

- `architecture-and-serving.md`
  - How the Node API, Python service, and model bundles work together, the service endpoints, and how Phase 4 calls (and defaults off) the ML extractor.
- `training-and-promotion.md`
  - Export, validation, staging, promotion, and rollout flow for the BIO extractor, style, and type bundles.
- `training-export-schema.md`
  - The admin training-export contract and the BIO supervision JSONL contract the extractor trainer consumes.
- `runbook.md`
  - Short quick-reference for health, rollout, and rollback.
- `ml-ops-runbook.md`
  - Detailed operational rollout/rollback/troubleshooting procedures (long form of `runbook.md`).
- `model-cards/phase4-extractor.md`
  - Model card for the Phase-4 ONNX BiLSTM extractor.
- `ml_system_plan.md`
  - File-by-file implemented and future documentation plan.

## Primary Source Files

- `ml-service/app/*` (FastAPI service, ONNX loader, BIO extraction)
- `ml-service/tools/*` (trainers, bundle validation/promotion)
- `ml-service/models/*` (`current` / `staged` / `promoted` bundles)
- `server/src/engine/phases/phase4Extract.ts` (engine ML call path + `ML_PHASE4_MODE` gating)
- `server/src/pipeline/executionPolicy.ts` (per-profile `extractionML` on/off)
- `server/src/ml/client.ts` (HTTP client to the ML service)
- `server/src/routes/adminTruthRoutes.ts` (bio-bundle build/promote routes)
