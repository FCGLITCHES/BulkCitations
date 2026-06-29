# Training And Promotion

Last verified on 2026-06-25.

This repo trains and promotes three local artifact families:

- the **Phase-4 BIO extractor** ONNX bundle (the model the engine's Phase 4 consumes),
- the **style classifier** bundle,
- the **type classifier** bundle.

The Phase-4 extractor is the one most relevant to engine quality. It is an ONNX **BiLSTM** token classifier (see the model card), not SciBERT/CRF.

## Authoritative Export Surface

- `GET /internal/admin/training-export`
- `GET /internal/admin/render-variant-export`

The governed export is the handoff point from reviewed truth data to training workflows.

The split is intentional:

- `training-export` is the canonical row export used by the current classifier lanes, including `style/core`.
- `render-variant-export` is the linked six-style render-variant lane used for renderer QA, augmentation experiments, and future render-specific training work.

Linked render variants are gold-quality derived artifacts, but they do not change the meaning of the canonical approved-truth row and they do not count toward `style/core` freeze/export totals by default.

## BIO Extractor Bundle Workflow

The Phase-4 extractor bundle is built and promoted in-repo. Two equivalent entry points exist.

### Admin HTTP routes (the primary workflow)

- `POST /admin/bio-dataset/export-supervision` — export reviewed approved-truth + learning-queue corrections to BIO supervision JSONL under `ml-service/datasets/citation-bio/processed/`.
- `POST /admin/bio-bundle/build` — train a staged bundle from a chosen dataset JSONL into `ml-service/models/staged/<version>` (runs `ml-service/tools/train_bio_bundle.py`).
- `POST /admin/bio-bundle/promote` — run the BIO promotion gate, then copy the staged bundle into `promoted/<version>` and `current/` (runs `ml-service/tools/promote_bundle.py`).
- `POST /admin/bio-bundle/publish-gold` — build + promote in one step using the gold dataset.
- `GET /admin/bio-training-status` — current/staged/promoted BIO bundle status and dataset status.

Dataset note: a default "build with no dataset" exports approved truth, but those rows carry `reviewed`/`holdout` splits, which yields **zero `train` rows**. Pick a dataset that actually contains `train` rows (e.g. the newest `real_train_*.jsonl`) explicitly. The trainer treats unsplit rows as `train`; rows split `val`/`test`/`holdout` are held out of training.

### Command-line path

- `pnpm run training:hf-bio-import` — import/refresh BIO gold input.
- `pnpm run training:hf-bio-bundle` (i.e. `python ml-service/tools/train_bio_bundle.py <jsonl>`) — train and stage a bundle.
- `python ml-service/tools/promote_bundle.py <modelVersion>` — validate and promote a staged bundle into `promoted/` and `current/`.

### What the trainer produces

`train_bio_bundle.py` writes a complete bundle into `models/staged/<version>`:

- `extractor.onnx` (the BiLSTM, opset 17, dynamic batch/sequence axes; `float32`, not quantized),
- `config.json` + tokenizer assets (WordLevel tokenizer),
- `metadata.json` (modelVersion, featureVersion, `bundleType: token-classification`, `bundleClass: standard`, id2label/label2id, dataset stats + lineage, metrics),
- `feature_manifest.json` (`featureVersion`, `labelSchema: BIO`, `datasetLineage`),
- `preprocessing.json`, `optimization_manifest.json`.

The build self-validates with `validate_bundle_dir` and fails if the bundle is structurally invalid.

## BIO Promotion Gate

`promoteBioBundleArtifact` evaluates `evaluateBioPromotionGate` before promoting (`server/src/routes/adminTruthRoutes.ts`). Promotion blocks only on **structural** checks; the rest are advisory because manual Review is the quality gate in the single-admin workflow:

- Blocking: `bundle_validation` (valid bundle), `bundle_is_bio_token_classifier` (`bundleType == token-classification` and `labelSchema == BIO`), `has_training_data` (`rows_total > 0`).
- Advisory (reported, non-blocking): `offline_holdout_eval_present` (val + test rows > 0), `phase4_shadow_history_present` (shadow diffs recorded for this version), `engine_benchmark_artifact_present`.

If you move to an unattended retraining loop, make the advisory checks blocking again.

## Style Bundle Workflow

The style classifier has its own local path:

- `pnpm run training:style-export`
- `pnpm run training:style-bundle`
- `python ml-service/tools/promote_style_bundle.py <modelVersion>`
- Admin equivalents: `POST /internal/admin/style-bundle/build`, `POST /internal/admin/style-bundle/promote`.

Canonical style export remains:

- one observed citation string
- one reviewed input style label
- one canonical approved-truth row

When an admin creates or promotes an approved-truth row with no structured truth fields yet, the server runs the local engine prefill first and saves the extracted `expectedFields`, `coreTruth`, and inferred `expectedType` before the row is persisted. Explicit admin-entered truth fields still win and are never overwritten by that first-save prefill.

Each staged style bundle includes:

- `style_model.json`
- `thresholds.json`
- `decision_policy.json`
- `reason_codes.json`

Promotion copies a staged style bundle into `ml-service/models/style-model/current/style_model.json`.

## Type Bundle Workflow

A parallel type-classifier bundle is trained by `ml-service/tools/train_type_bundle.py` and promoted by `ml-service/tools/promote_type_bundle.py`; its version is reported in service health (`typeModelVersion`, `typeFeatureVersion`).

## Local Bootstrap Path

For local development, `node scripts/ensure-bootstrap-bundle.mjs` (wired into `dev:legacy`) seeds a bootstrap bundle so the service has something to load. Bootstrap-class bundles are development-only and are refused in production unless `ML_ALLOW_BOOTSTRAP_BUNDLE` is set.

## Promotion Requirements

Before promotion, confirm:

- bundle structure validates
- offline evaluation passes (or manual Review has signed off for the BIO bundle)
- metadata is present
- for style bundles, threshold policy and reason-code artifacts are present
- rollback target is known
- model-card updates are ready

## Admin Truth Review Workflow

In the admin truth editor, the default review path is intentionally narrow:

- `Raw citation text`
- `Expected fields`
- `Expected type`
- `Input style label`
- `Provenance`

Governance and audit metadata are collapsed into an advanced section so routine truth review behaves like a focused citation-review workflow rather than a data-model editor. The same ordered workflow applies in both the truth editor and learning-queue promotion:

1. review the source citation text
2. confirm the canonical `Expected fields`
3. set `Expected type`, `Input style label`, and provenance
4. open governance and audit only when needed
5. generate linked six-style render variants only after the canonical row is saved

## Production Boundary

- bootstrap bundles are for local development only
- production-quality training is expected to remain external to this repo
- public deployments should use reviewed exports and real promoted bundles, not development bootstrap artifacts
- renderer-derived linked variants are internal/admin artifacts until an explicit downstream consumer is wired to them
