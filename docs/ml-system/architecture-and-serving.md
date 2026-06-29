# ML Architecture And Serving

Last verified on 2026-06-25.

## Current Role Of The ML System

The ML system is a local decision service that supports the citation engine. It serves two related functions:

- **Phase-4 field extraction** — an ONNX BIO token-classification model (`/v1/ml/extract`), consumed by the engine's Phase 4 to selectively augment heuristic field extraction.
- **Style routing** — local open-set style decisions (`/v1/ml/detect-style`) with deterministic fallback.

Both are advisory: the engine's heuristic/deterministic paths are the primary, always-available behavior, and the ML output is layered on top only when policy enables it.

## The Extractor Model (What It Is And Is Not)

- The Phase-4 extractor is an **ONNX BiLSTM token classifier**, not SciBERT, not a CRF, and not a transformer encoder.
- It is `TinyTokenClassifier` from `ml-service/tools/train_bio_bundle.py`: `Embedding(96)` → bidirectional `LSTM(96)` → `Linear(192 → labels)`, exported to `extractor.onnx` (opset 17) and run by `onnxruntime` on `CPUExecutionProvider` (`ml-service/app/models/onnx_extractor.py`).
- The bundle ships its own WordLevel tokenizer (whitespace + isolated-punctuation pre-tokenizer). A `BertConfig` is written only to carry label maps/shape metadata; no BERT weights are loaded.
- The Hugging Face pipeline ids in `ml-service/app/models/loader.py` `_MODEL_CONFIGS` (`bert-base-uncased`, `SIRIS-Lab/citation-parser-ENTITY`) are optional lazy helper pipelines and are **not** the served Phase-4 extractor.

## Runtime Components

- Node API (engine)
  - owns HTTP routes, orchestration, quotas, persistence, and product-facing contracts
  - reaches the ML service over HTTP at `ML_SERVICE_URL` (default `http://localhost:8123`) via `server/src/ml/client.ts`
- Python ML service
  - FastAPI app (`ml-service/app/main.py`, served on `:8123`) that loads ONNX bundles and local style decision policy
  - title `BulkReferences ML Service`, version `1.2.0`; warms up on startup with a sample extract
- Model registry directories (resolved by `ml-service/app/models/loader.py`, override with `MODEL_DIR`)
  - `ml-service/models/current` (active bundle)
  - `ml-service/models/staged`
  - `ml-service/models/promoted`
  - `ml-service/models/style-model/current`
  - A `MODEL_VERSION_PIN` / runtime pin can point the loader at a specific `promoted/<v>`, `staged/<v>`, or `<v>` directory.

## How The Engine Calls Phase-4 ML (Default Is OFF)

1. The execution policy for the parse profile decides whether ML runs (`server/src/pipeline/executionPolicy.ts`). `core_parse_fast` (the fast lane used by `site_default` / browser site-default traffic) sets `extractionML: 'off'`, so **the model is never called in the default fast lane**. ML is `routed` only in `core_parse_full*`, `pro_overlay_enrich`, `debug_full`, and `current_runtime`.
2. When ML is routed, Phase-4 reads `ML_PHASE4_MODE` (`server/src/engine/phases/phase4Extract.ts`):
   - `heuristic` (default; `parseMode` returns `heuristic` for any value that is not `shadow`/`primary`) — ML is not attempted.
   - `shadow` — ML runs, the diff is recorded, but heuristic output ships.
   - `primary` — ML runs and **selectively patches individual heuristic fields** (`buildPrimaryMlPatchPrediction`); it never wholesale-replaces the heuristic result.
3. Per-carrier selection (`selectPlanForCarrier`) can still bypass ML for unsupported styles, detection uncertainty, or the shadow/primary traffic fractions (`ML_PHASE4_SHADOW_FRACTION`, `ML_PHASE4_PRIMARY_FRACTION`).
4. The heuristic prediction is always computed first and is the fallback for any ML failure (`INFERENCE_TIMEOUT`, `MODEL_UNAVAILABLE`, `CIRCUIT_OPEN`, `QUEUE_FULL`, `BAD_REQUEST`, `INTERNAL_ERROR`) or missing bundle.

The ML service itself also degrades gracefully: if no ONNX bundle is loadable, `/v1/ml/extract` falls back to its own internal regex heuristic and reports `backend: "heuristic"`.

## Service Endpoints

FastAPI exposes both `/v1/ml/*` and legacy `/ml/*` aliases:

- `GET /v1/ml/health` — runtime status (`ok` / `degraded` / `unavailable`), active model/feature version, `backend` (`onnx` / `heuristic` / `missing`), bundle validation errors/warnings, warmup state, style/type bundle versions.
- `POST /v1/ml/detect-style` — open-set style decisions plus `primary`/`secondary` hints.
- `POST /v1/ml/extract` and `POST /v1/ml/batch-extract` — field extraction (max 128 items/batch); returns `fields`, `fieldConfidences`, `fieldUncertainty`, `uncertainFields`, `entities`, and a first-class `bio` object when the active bundle is BIO-capable.
- `POST /v1/ml/author-ner` — author span parsing.
- `POST /v1/ml/classify-type` — citation type classification.
- `POST /v1/ml/ingest-pdf`, `POST /v1/ml/ingest-docx` — bounded document text extraction (`ML_INGEST_MAX_BYTES`, default 2 MB).
- `GET /metrics` — Prometheus metrics.
- `GET|PUT /v1/ml/admin/runtime` — read or set the model-version pin; guarded by the `X-ML-Admin-Secret` header (disabled until `ML_ADMIN_SECRET` is set).

## `bio` Extraction Payload

`/v1/ml/extract` returns a `bio` object when the active extraction bundle is BIO-capable:

- `tokens`, `labels`, `offsets`, `labelConfidences`, `entities`, `diagnostics`, `labelSchemaVersion`, `featureVersion`, and `modelVersion`.
- `diagnostics` flag span anomalies such as `unclosed_bio_sequence` and `overlapping_spans`.

## `detect-style` Decisions

`/v1/ml/detect-style` returns decision-policy outputs:

- `supported_exact`
- `family_only`
- `known_unsupported_exact`
- `unknown_or_ood`
- `not_citation_like`

The endpoint still returns `primary`/`secondary` hints for backward compatibility. Policy artifacts (`thresholds`, `decision_policy`, `reason_codes`) are versioned separately from model weights.

## Startup Expectations

- The active bundle directory must be valid (`ml-service/app/bundle_validation.py`): ONNX file, `config.json`, tokenizer assets, `metadata.json`, `feature_manifest.json`, `preprocessing.json`, `optimization_manifest.json`, and an `id2label`.
- Preprocessing and metadata files must match the bundle.
- Style decision policy artifacts should be present when style bundles are promoted.
- The service warms up (a sample extract) before being considered ready; warmup state is surfaced in health.
- Bootstrap-class bundles are refused in production (`NODE_ENV=production`) unless `ML_ALLOW_BOOTSTRAP_BUNDLE` is set.

## BIO Promotion Contract

- Reviewed approved truth and processed learning-queue corrections are exported to BIO supervision JSONL under `ml-service/datasets/citation-bio/processed/`.
- BIO bundle build routes train from that JSONL into `ml-service/models/staged/<version>` via `train_bio_bundle.py`.
- BIO promotion is gated by bundle validation and BIO token-classifier metadata as hard (blocking) checks; held-out val/test counts, Phase-4 shadow history for the candidate version, and an available engine benchmark artifact are reported but **advisory** in the single-admin manual-review workflow.
- Shadow and primary rollout use `ML_PHASE4_MODE`, `ML_PHASE4_SHADOW_FRACTION`, and `ML_PHASE4_PRIMARY_FRACTION`.

## Important Boundary

Production-quality training is expected to remain external to this repository. This repository governs:

- export format
- bundle validation
- staging and promotion layout
- local training of the BIO BiLSTM bundle and local evaluation
- runtime serving and rollout controls
